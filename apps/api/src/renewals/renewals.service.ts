import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PanelConnection, RenewalRequest, RenewalStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { BrandsService, hmError, parsePlans } from '../brands/brands.service';
import { HM_ORDER_DONE, HM_ORDER_REFUSED } from '../integrations/hmpanel/hmpanel.client';
import { brandScope } from '../common/access/scope';
import { decryptSecret, encryptSecret } from '../common/crypto/secret.crypto';
import { PanelGatewayService } from '../panels/panel-gateway.service';
import { describeTerms, normalizeTerms } from '../panels/renewal-terms';
import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';
import { PushService } from '../push/push.service';
import { fill, parseReminderSettings } from '../push/reminder-settings';
import { ReviewInfo, SentReceipt, TelegramService } from '../telegram/telegram.service';

type RenewalRow = Omit<RenewalRequest, 'receiptData'>;

const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class RenewalsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RenewalsService.name);
  private syncTimer?: ReturnType<typeof setInterval>;
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly brands: BrandsService,
    private readonly lookup: PublicService,
    private readonly gateway: PanelGatewayService,
    private readonly push: PushService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramService,
  ) {}

  /** HMPanel store orders are decided over there; follow them every minute. */
  onApplicationBootstrap() {
    this.syncTimer = setInterval(() => {
      void this.syncExternal().catch(() => undefined);
      void this.autoDecide().catch((err) => this.logger.warn(`Auto decide failed: ${(err as Error).message}`));
    }, 60_000);
    this.syncTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  // ---------- public ----------

  async create(input: {
    tenant?: string;
    url: string;
    planId: string;
    receipt: string;
    payerName?: string;
    payerNote?: string;
    deviceEndpoint?: string;
  }) {
    const brand = await this.brands.resolve(input.tenant);
    if (!brand?.renewalEnabled) throw new BadRequestException('Renewal is not available here');
    const plan = parsePlans(brand.plansJson).find((p) => p.id === input.planId && p.price.trim());
    if (!plan) throw new BadRequestException('Choose one of the listed plans');
    const viaHm = brand.renewalVia === 'hmpanel' && Boolean(brand.renewalPanelId);
    if (viaHm && !plan.productId) throw new BadRequestException('This plan is not linked to a store product');

    const { mime, data } = parseDataUrl(input.receipt);
    const receiptHash = createHash('sha256').update(data).digest('hex');
    // A receipt that already paid for a renewal cannot pay for another one.
    const used = await this.prisma.renewalRequest.findFirst({
      where: { brandId: brand.id, receiptHash, status: RenewalStatus.APPROVED },
      select: { id: true },
    });
    if (used) throw new BadRequestException('This receipt was already used for a renewal');

    const found = await this.lookup.lookup(brand, input.url);
    const subId = found.subId ?? found.snapshot.subscriptionId;
    if (plan.service && found.serviceKind && plan.service !== found.serviceKind) {
      throw new BadRequestException('This plan is for a different kind of service');
    }
    if (
      (plan.panelId && found.account && plan.panelId !== found.account.panelId) ||
      (plan.sourcePanelId && found.account?.sourcePanelRef && plan.sourcePanelId !== found.account.sourcePanelRef)
    ) {
      throw new BadRequestException('This plan is for a different panel than your service');
    }
    // HMPanel locks a store-sold service to its product category; offer only matching plans.
    if (plan.categoryId && brand.renewalPanelId && found.account?.panelId === brand.renewalPanelId) {
      const locked = await this.brands
        .serviceCategory(brand.renewalPanelId, found.account.clientRef, found.account.clientEmail)
        .catch(() => null);
      if (locked && locked !== plan.categoryId) throw new BadRequestException('This plan is from a different store category than your service');
    }

    // Through HMPanel: the account must live on that panel, so the store renews that exact client.
    let hmPanel: PanelConnection | null = null;
    let hmClientId: string | null = null;
    if (viaHm) {
      hmPanel = await this.prisma.panelConnection.findUnique({ where: { id: brand.renewalPanelId! } });
      if (!hmPanel) throw new BadRequestException('Renewal is not available here');
      hmClientId =
        found.account?.panelId === hmPanel.id
          ? found.account.clientRef
          : ((await this.gateway.find(hmPanel, input.url, subId))?.clientRef ?? null);
      if (!hmClientId) throw new BadRequestException('This subscription was not found in the store; contact support');
    }

    const open = await this.prisma.renewalRequest.count({
      where: { brandId: brand.id, subId, status: RenewalStatus.PENDING },
    });
    if (open >= 3) {
      throw new BadRequestException('You already have requests waiting for review');
    }

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const row = await this.prisma.renewalRequest.create({
      data: {
        orgId: brand.orgId,
        brandId: brand.id,
        subId,
        subUrlEnc: encryptSecret(input.url, key),
        displayName: found.snapshot.displayName,
        panelId: hmPanel?.id ?? found.account?.panelId ?? null,
        clientRef: hmClientId ?? found.account?.clientRef ?? null,
        planId: plan.id,
        planTitle: plan.title,
        days: plan.days,
        gb: plan.gb,
        users: plan.users,
        mode: plan.mode,
        price: plan.price,
        payerName: input.payerName?.trim().slice(0, 80) || null,
        payerNote: input.payerNote?.trim().slice(0, 300) || null,
        receiptMime: mime,
        receiptData: new Uint8Array(data),
        receiptHash,
        deviceEndpoint: input.deviceEndpoint?.slice(0, 1024) || null,
      },
    });
    if (hmPanel && hmClientId) {
      try {
        const order = await this.gateway.hmStore(hmPanel).createOrder({
          productId: plan.productId!,
          name: (input.payerName?.trim() || found.snapshot.displayName || subId).slice(0, 80),
          paymentMethod: 'MANUAL_BANK',
          receiptText: input.payerNote?.trim().slice(0, 300) || undefined,
          receiptImage: input.receipt,
          isRenewal: true,
          renewClientId: hmClientId,
          ...(plan.users > 0 ? { limitIp: plan.users } : {}),
        });
        const updated = await this.prisma.renewalRequest.update({
          where: { id: row.id },
          data: { externalOrderId: order.orderId ?? order.id ?? null, externalCode: order.trackingCode ?? null, externalSyncedAt: new Date() },
          omit: { receiptData: true },
        });
        if (this.telegram.isConfigured(brand)) {
          void this.telegram
            .broadcast(
              brand,
              `🧾 رسید تمدید <b>${escHtml(row.displayName || subId)}</b> · ${escHtml(plan.title)} — ${escHtml(plan.price)}\n` +
                `در فروشگاه HMPanel ثبت شد (کد پیگیری <code>${escHtml(order.trackingCode ?? '-')}</code>). تأیید از ربات یا پنل HMPanel.`,
            )
            .catch(() => undefined);
        }
        return this.toPublic(updated);
      } catch (err) {
        if (!storeCannotRenew(err)) {
          await this.prisma.renewalRequest.delete({ where: { id: row.id } }).catch(() => undefined);
          throw new BadRequestException(hmError(err));
        }
        // The store only renews services it sold to its own admin. Review it here instead;
        // approval still renews through HMPanel's client API (same admin credit, same inbounds).
        await this.prisma.renewalRequest
          .update({ where: { id: row.id }, data: { applyMessage: `HMPanel store: ${hmError(err)} — reviewed in NeoConfig` } })
          .catch(() => undefined);
      }
    }

    void this.review(row, found.snapshot)
      .then((review) => this.telegram.renewalReceived(brand, { ...row, review }, { mime, data }))
      .then((refs) => this.saveTelegramRefs(row.id, refs))
      .catch(() => undefined);
    return this.toPublic(row);
  }

  /** A new service bought in the app: an HMPanel store order; the link arrives once it is delivered. */
  async createPurchase(input: {
    tenant?: string;
    planId: string;
    receipt: string;
    payerName?: string;
    payerNote?: string;
    deviceEndpoint?: string;
  }) {
    const brand = await this.brands.resolve(input.tenant);
    if (!brand?.purchaseEnabled || !brand.renewalPanelId || !brand.renewalEnabled) {
      throw new BadRequestException('Buying a new service is not available here');
    }
    const plan = parsePlans(brand.plansJson).find((p) => p.id === input.planId && p.price.trim() && p.productId);
    if (!plan) throw new BadRequestException('Choose one of the listed plans');
    const panel = await this.prisma.panelConnection.findUnique({ where: { id: brand.renewalPanelId } });
    if (!panel || panel.type !== 'hmpanel') throw new BadRequestException('Buying a new service is not available here');

    const { mime, data } = parseDataUrl(input.receipt);
    const receiptHash = createHash('sha256').update(data).digest('hex');
    const used = await this.prisma.renewalRequest.findFirst({
      where: { brandId: brand.id, receiptHash, status: RenewalStatus.APPROVED },
      select: { id: true },
    });
    if (used) throw new BadRequestException('This receipt was already used for a renewal');

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const name = input.payerName?.trim().slice(0, 80) || null;
    const row = await this.prisma.renewalRequest.create({
      data: {
        orgId: brand.orgId,
        brandId: brand.id,
        kind: 'purchase',
        subId: `new:${createHash('sha1').update(receiptHash + Date.now()).digest('hex').slice(0, 12)}`,
        subUrlEnc: encryptSecret('', key),
        displayName: name ? `${name} (خرید جدید)` : 'خرید سرویس جدید',
        panelId: panel.id,
        clientRef: null,
        planId: plan.id,
        planTitle: plan.title,
        days: plan.days,
        gb: plan.gb,
        users: plan.users,
        mode: plan.mode,
        price: plan.price,
        payerName: name,
        payerNote: input.payerNote?.trim().slice(0, 300) || null,
        receiptMime: mime,
        receiptData: new Uint8Array(data),
        receiptHash,
        deviceEndpoint: input.deviceEndpoint?.slice(0, 1024) || null,
      },
    });
    try {
      const order = await this.gateway.hmStore(panel).createOrder({
        productId: plan.productId!,
        name: name || 'NeoConfig customer',
        paymentMethod: 'MANUAL_BANK',
        receiptText: input.payerNote?.trim().slice(0, 300) || undefined,
        receiptImage: input.receipt,
        isRenewal: false,
        configName: configNameFrom(name),
        ...(plan.users > 0 ? { limitIp: plan.users } : {}),
      });
      const updated = await this.prisma.renewalRequest.update({
        where: { id: row.id },
        data: { externalOrderId: order.orderId ?? order.id ?? null, externalCode: order.trackingCode ?? null, externalSyncedAt: new Date() },
        omit: { receiptData: true },
      });
      if (this.telegram.isConfigured(brand)) {
        void this.telegram
          .broadcast(
            brand,
            `🛒 <b>خرید سرویس جدید</b> · ${escHtml(plan.title)} — ${escHtml(plan.price)}${name ? `\n💳 ${escHtml(name)}` : ''}\n` +
              `در فروشگاه HMPanel ثبت شد (کد پیگیری <code>${escHtml(order.trackingCode ?? '-')}</code>). تأیید از ربات یا پنل HMPanel.`,
          )
          .catch(() => undefined);
      }
      return this.toPublic(updated);
    } catch (err) {
      await this.prisma.renewalRequest.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new BadRequestException(hmError(err));
    }
  }

  async statuses(ids: string[]) {
    // Customers waiting on an HMPanel order see the decision as soon as it's made.
    await this.syncExternal({ ids: ids.slice(0, 30), minAgeMs: 20_000 }).catch(() => undefined);
    const rows = await this.prisma.renewalRequest.findMany({
      where: { id: { in: ids.slice(0, 30) } },
      omit: { receiptData: true, subUrlEnc: true },
      orderBy: { createdAt: 'desc' },
    });
    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    return rows.map((r) => ({
      ...this.toPublic(r),
      // Only whoever holds the request id (the buyer's device) ever sees the new link.
      subscriptionUrl: r.kind === 'purchase' && r.resultUrlEnc ? decryptSecret(r.resultUrlEnc, key) : null,
    }));
  }

  // ---------- admin ----------

  async list(user: AuthUser, filter: { status?: string; brandId?: string }) {
    const status = Object.values(RenewalStatus).includes(filter.status as RenewalStatus)
      ? (filter.status as RenewalStatus)
      : undefined;
    const rows = await this.prisma.renewalRequest.findMany({
      where: {
        brand: brandScope(user),
        ...(status ? { status } : {}),
        ...(filter.brandId ? { brandId: filter.brandId } : {}),
      },
      omit: { receiptData: true, subUrlEnc: true },
      include: { brand: { select: { id: true, appName: true, primaryColor: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      brand: r.brand,
      subId: r.subId,
      displayName: r.displayName,
      planTitle: r.planTitle,
      days: r.days,
      gb: r.gb,
      users: r.users,
      mode: r.mode,
      price: r.price,
      payerName: r.payerName,
      payerNote: r.payerNote,
      status: r.status,
      adminNote: r.adminNote,
      canApply: Boolean(r.panelId && r.clientRef),
      via: r.externalOrderId ? 'hmpanel' : 'local',
      kind: r.kind,
      autoDecided: r.autoDecided,
      externalCode: r.externalCode,
      appliedOnPanel: r.appliedOnPanel,
      applyMessage: r.applyMessage,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  }

  /** For the admin menu dot: how many receipts wait, and when the newest came in. */
  async pendingCount(user: AuthUser) {
    const where = { brand: brandScope(user), status: RenewalStatus.PENDING };
    const [count, latest] = await Promise.all([
      this.prisma.renewalRequest.count({ where }),
      this.prisma.renewalRequest.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return { count, latestAt: latest?.createdAt.toISOString() ?? null };
  }

  /**
   * Receipts nobody reviewed within the brand's time limit get the brand's
   * default decision. Each request is tried once; a panel that refuses the
   * renewal leaves it pending for a person. HMPanel store orders follow
   * HMPanel's own auto-approval instead.
   */
  async autoDecide(now = new Date()) {
    const brands = await this.prisma.brand.findMany({
      where: { autoDecideMinutes: { gt: 0 } },
      select: { id: true, autoDecideMinutes: true, autoDecideAction: true },
    });
    for (const brand of brands) {
      const due = await this.prisma.renewalRequest.findMany({
        where: {
          brandId: brand.id,
          status: RenewalStatus.PENDING,
          externalOrderId: null,
          autoTriedAt: null,
          createdAt: { lt: new Date(now.getTime() - brand.autoDecideMinutes * 60_000) },
        },
        omit: { receiptData: true },
        take: 20,
      });
      for (const row of due) {
        // Claim first so a second instance or the next tick never repeats it.
        const claimed = await this.prisma.renewalRequest.updateMany({
          where: { id: row.id, autoTriedAt: null, status: RenewalStatus.PENDING },
          data: { autoTriedAt: now },
        });
        if (!claimed.count) continue;
        try {
          if (brand.autoDecideAction === 'reject') {
            await this.decideReject(row, {
              note: 'پرداخت در زمان مقرر تأیید نشد؛ اگر واریز کرده‌اید با پشتیبانی تماس بگیرید.',
              by: 'رد خودکار',
              userId: null,
              telegramOrigin: false,
              auto: true,
            });
          } else {
            await this.decideApprove(row, {
              apply: Boolean(row.panelId && row.clientRef),
              by: 'تأیید خودکار',
              userId: null,
              telegramOrigin: false,
              auto: true,
            });
          }
        } catch (err) {
          this.logger.warn(`Auto decision for ${row.id} left for a person: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  async receipt(user: AuthUser, id: string) {
    const row = await this.prisma.renewalRequest.findFirst({
      where: { id, brand: brandScope(user) },
      select: { receiptData: true, receiptMime: true },
    });
    if (!row) throw new NotFoundException('Request not found');
    return { mime: row.receiptMime, data: Buffer.from(row.receiptData) };
  }

  async approve(user: AuthUser, id: string, opts: { apply: boolean; note?: string }) {
    const row = await this.mustFind(user, id);
    return this.decideApprove(row, { ...opts, by: user.email, userId: user.id, telegramOrigin: false });
  }

  async reject(user: AuthUser, id: string, note?: string) {
    const row = await this.mustFind(user, id);
    return this.decideReject(row, { note, by: user.email, userId: user.id, telegramOrigin: false });
  }

  /**
   * Decisions from the brand's Telegram group (inline buttons). The webhook
   * has already checked the secret and the chat; renewals are applied on the
   * panel whenever the account was found there.
   */
  async decideFromTelegram(
    brandId: string,
    id: string,
    decision: { approve: boolean; apply?: boolean; note?: string },
    by: string,
  ) {
    const row = await this.prisma.renewalRequest.findFirst({ where: { id, brandId }, omit: { receiptData: true } });
    if (!row) throw new NotFoundException('Request not found');
    // Approve always tries the panel (resolveTarget re-runs the lookup if the account moved);
    // "manual" approves without touching it, after the panel refused.
    return decision.approve
      ? this.decideApprove(row, { apply: decision.apply ?? true, note: decision.note, by, userId: null, telegramOrigin: true })
      : this.decideReject(row, { note: decision.note, by, userId: null, telegramOrigin: true });
  }

  /** /pending in the team chat: the oldest waiting requests, re-sent with their receipts. */
  async resendPending(brandId: string, limit = 8) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand) return 0;
    const rows = await this.prisma.renewalRequest.findMany({
      where: { brandId, status: RenewalStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    for (const row of rows) {
      const review = await this.review(row, undefined);
      const refs = await this.telegram.renewalReceived(brand, { ...row, review }, { mime: row.receiptMime, data: Buffer.from(row.receiptData) });
      await this.saveTelegramRefs(row.id, [...readRefs(row.telegramMsgs), ...refs]);
    }
    return rows.length;
  }

  /** /stats in the team chat. */
  async stats(brandId: string) {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const count = (where: object) => this.prisma.renewalRequest.count({ where: { brandId, ...where } });
    const [pending, todayApproved, todayRejected, monthApproved, monthRejected, failed] = await Promise.all([
      count({ status: RenewalStatus.PENDING }),
      count({ status: RenewalStatus.APPROVED, decidedAt: { gte: day } }),
      count({ status: RenewalStatus.REJECTED, decidedAt: { gte: day } }),
      count({ status: RenewalStatus.APPROVED, decidedAt: { gte: month } }),
      count({ status: RenewalStatus.REJECTED, decidedAt: { gte: month } }),
      count({ status: RenewalStatus.PENDING, appliedOnPanel: false }),
    ]);
    return { pending, todayApproved, todayRejected, monthApproved, monthRejected, failed };
  }

  /** Automatic checks shown under each receipt in Telegram. */
  private async review(
    row: { id: string; brandId: string; subId: string; receiptHash: string | null; panelId: string | null; clientRef: string | null },
    current: ReviewInfo['current'] | undefined,
  ): Promise<ReviewInfo> {
    const [duplicate, approved, pendingCount] = await Promise.all([
      row.receiptHash
        ? this.prisma.renewalRequest.findFirst({
            where: { brandId: row.brandId, receiptHash: row.receiptHash, id: { not: row.id } },
            select: { id: true, createdAt: true, status: true, displayName: true },
            orderBy: { createdAt: 'asc' },
          })
        : null,
      this.prisma.renewalRequest.findMany({
        where: { brandId: row.brandId, subId: row.subId, status: RenewalStatus.APPROVED },
        select: { decidedAt: true },
        orderBy: { decidedAt: 'desc' },
        take: 50,
      }),
      this.prisma.renewalRequest.count({ where: { brandId: row.brandId, subId: row.subId, status: RenewalStatus.PENDING } }),
    ]);
    const panel = row.panelId
      ? await this.prisma.panelConnection.findUnique({ where: { id: row.panelId }, select: { name: true, type: true } }).catch(() => null)
      : null;
    return {
      panel,
      current: current ?? null,
      duplicateOf: duplicate,
      approvedBefore: approved.length,
      lastApprovedAt: approved[0]?.decidedAt ?? null,
      pendingCount,
      canApply: Boolean(row.panelId && row.clientRef),
    };
  }

  private async decideApprove(
    row: RenewalRow,
    opts: { apply: boolean; note?: string; by: string; userId: string | null; telegramOrigin: boolean; externalDone?: boolean; auto?: boolean },
  ) {
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');
    const terms = normalizeTerms({ days: row.days, gb: row.gb, users: row.users, mode: row.mode as 'add' | 'reset' });
    let appliedOnPanel: boolean | null = null;
    let applyMessage: string | null = null;
    if (row.externalOrderId) {
      // The HMPanel store delivers the renewal (and charges that admin); just tell it.
      if (!opts.externalDone) {
        const store = await this.storeFor(row);
        try {
          await store.approve(row.externalOrderId);
        } catch (err) {
          throw new BadRequestException(hmError(err));
        }
        // A new service finishes when HMPanel hands over its link (picked up by the sync).
        if (row.kind === 'purchase') {
          await this.prisma.renewalRequest.update({ where: { id: row.id }, data: { applyMessage: 'Approved in HMPanel — waiting for delivery' } });
          void this.syncExternal({ ids: [row.id] }).catch(() => undefined);
          return { ok: true, appliedOnPanel: null, applyMessage: 'Waiting for HMPanel to deliver the service', notified: 0 };
        }
      }
      appliedOnPanel = true;
      applyMessage = `HMPanel ${row.externalCode ?? ''}`.trim();
    } else if (opts.apply) {
      const target = await this.resolveTarget(row);
      if (!target) {
        throw new BadRequestException('Account not found on any panel. Approve without applying and renew it manually.');
      }
      const res = await this.gateway.renew(target.panel, target.clientRef, terms);
      appliedOnPanel = res.ok;
      applyMessage = res.ok ? `${describeTerms(terms)} — ${res.message}` : res.message;
      if (!res.ok) {
        // Stay pending so the admin can retry or approve without applying.
        await this.prisma.renewalRequest.update({ where: { id: row.id }, data: { appliedOnPanel, applyMessage } });
        throw new BadRequestException(`Panel did not accept the renewal: ${res.message}`);
      }
    }

    await this.prisma.renewalRequest.update({
      where: { id: row.id },
      data: {
        status: RenewalStatus.APPROVED,
        autoDecided: Boolean(opts.auto),
        adminNote: opts.note?.trim().slice(0, 300) || null,
        appliedOnPanel,
        applyMessage,
        decidedAt: new Date(),
        decidedById: opts.userId,
      },
    });
    // Every decision (button, panel, timer, HMPanel) closes the receipt for all admins.
    void this.notifyTeam(row, { approved: true, by: opts.by, appliedOnPanel, note: opts.note });
    const push = await this.push.notifySubscription(
      row.brandId,
      row.subId,
      row.kind === 'purchase'
        ? { title: 'سرویس جدید شما آماده است', body: `${row.planTitle} — برای افزودن به برنامه، اپ را باز کنید.`, url: `/?renewal=${row.id}`, tag: `renewal-${row.id}` }
        : { ...(await this.pushText(row.brandId, 'approved', { plan: row.planTitle, name: row.displayName })), url: `/?renewal=${row.id}`, tag: `renewal-${row.id}` },
      row.deviceEndpoint,
    );
    await this.audit.log({
      orgId: row.orgId,
      userId: opts.userId,
      action: 'renewal.approve',
      resource: 'renewal',
      resourceId: row.id,
      meta: { appliedOnPanel, by: opts.by },
    });
    return { ok: true, appliedOnPanel, applyMessage, notified: push.sent };
  }

  private async decideReject(
    row: RenewalRow,
    opts: { note?: string; by: string; userId: string | null; telegramOrigin: boolean; externalDone?: boolean; auto?: boolean },
  ) {
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');
    if (row.externalOrderId && !opts.externalDone) {
      const store = await this.storeFor(row);
      try {
        await store.reject(row.externalOrderId, opts.note?.trim() || 'Payment not confirmed');
      } catch (err) {
        throw new BadRequestException(hmError(err));
      }
    }
    await this.prisma.renewalRequest.update({
      where: { id: row.id },
      data: {
        status: RenewalStatus.REJECTED,
        autoDecided: Boolean(opts.auto),
        adminNote: opts.note?.trim().slice(0, 300) || null,
        decidedAt: new Date(),
        decidedById: opts.userId,
      },
    });
    void this.notifyTeam(row, { approved: false, by: opts.by, appliedOnPanel: null, note: opts.note });
    const push = await this.push.notifySubscription(
      row.brandId,
      row.subId,
      {
        ...(await this.pushText(row.brandId, 'rejected', {
          plan: row.planTitle,
          name: row.displayName,
          reason: opts.note?.trim() || 'پرداخت شما تأیید نشد. برای دیدن علت و تماس با پشتیبانی، اپ را باز کنید.',
        })),
        ...(row.kind === 'purchase' ? { title: 'خرید شما تأیید نشد' } : {}),
        url: `/?renewal=${row.id}`,
        tag: `renewal-${row.id}`,
      },
      row.deviceEndpoint,
    );
    await this.audit.log({ orgId: row.orgId, userId: opts.userId, action: 'renewal.reject', resource: 'renewal', resourceId: row.id, meta: { by: opts.by } });
    return { ok: true, notified: push.sent };
  }

  private async notifyTeam(
    row: { id: string; brandId: string; displayName: string | null; subId: string; planTitle: string; price?: string },
    decision: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null },
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: row.brandId } }).catch(() => null);
    if (!brand || !this.telegram.isConfigured(brand)) return;
    const fresh = await this.prisma.renewalRequest.findUnique({ where: { id: row.id }, select: { telegramMsgs: true } }).catch(() => null);
    const summary = `👤 ${escHtml(row.displayName || row.subId)} · ${escHtml(row.planTitle)}${row.price ? ` — ${escHtml(row.price)}` : ''}`;
    await this.telegram.closeReceipts(brand, readRefs(fresh?.telegramMsgs), decision, summary).catch(() => undefined);
  }

  private async saveTelegramRefs(id: string, refs: SentReceipt[]) {
    if (!refs.length) return;
    await this.prisma.renewalRequest.update({ where: { id }, data: { telegramMsgs: JSON.stringify(refs.slice(-20)) } }).catch(() => undefined);
  }

  /** The brand's own wording for renewal pushes (Notifications tab), with the values filled in. */
  private async pushText(brandId: string, key: 'approved' | 'rejected', vars: Record<string, string | null>) {
    const brand = await this.prisma.brand
      .findUnique({ where: { id: brandId }, select: { reminderJson: true, defaultLocale: true, appName: true } })
      .catch(() => null);
    const t = parseReminderSettings(brand?.reminderJson, brand?.defaultLocale).texts[key];
    const values = { app: brand?.appName ?? '', ...vars };
    return { title: fill(t.title, values), body: fill(t.body, values) || String(vars.reason ?? '') };
  }

  private async storeFor(row: { panelId: string | null }) {
    const panel = row.panelId ? await this.prisma.panelConnection.findUnique({ where: { id: row.panelId } }) : null;
    if (!panel || panel.type !== 'hmpanel') throw new BadRequestException('The HMPanel connection for this order is gone');
    return this.gateway.hmStore(panel);
  }

  /**
   * Pull decisions made in HMPanel (its bot or panel) for open store orders and
   * finish them here: status, push to the customer, audit.
   */
  async syncExternal(filter: { ids?: string[]; minAgeMs?: number } = {}) {
    if (this.syncing && !filter.ids) return;
    if (!filter.ids) this.syncing = true;
    try {
      const rows = await this.prisma.renewalRequest.findMany({
        where: {
          status: RenewalStatus.PENDING,
          externalOrderId: { not: null },
          ...(filter.ids ? { id: { in: filter.ids } } : {}),
          ...(filter.minAgeMs ? { OR: [{ externalSyncedAt: null }, { externalSyncedAt: { lt: new Date(Date.now() - filter.minAgeMs) } }] } : {}),
        },
        omit: { receiptData: true },
        take: 50,
      });
      for (const row of rows) {
        try {
          const order = await (await this.storeFor(row)).order(row.externalOrderId!);
          await this.prisma.renewalRequest.update({ where: { id: row.id }, data: { externalSyncedAt: new Date() } });
          if (HM_ORDER_DONE.has(order.status)) {
            if (row.kind === 'purchase') {
              if (!order.subscriptionUrl) continue; // approved, still being built
              const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
              await this.prisma.renewalRequest.update({ where: { id: row.id }, data: { resultUrlEnc: encryptSecret(order.subscriptionUrl, key) } });
            }
            await this.decideApprove(row, { apply: false, by: 'HMPanel', userId: null, telegramOrigin: false, externalDone: true });
          } else if (HM_ORDER_REFUSED.has(order.status)) {
            const reason = order.rejectReason ?? order.payment?.rejectReason ?? undefined;
            await this.decideReject(row, { note: reason ?? undefined, by: 'HMPanel', userId: null, telegramOrigin: false, externalDone: true });
          } else if (order.status === 'PROVISION_FAILED' && order.provisionError) {
            await this.prisma.renewalRequest.update({ where: { id: row.id }, data: { applyMessage: order.provisionError.slice(0, 300) } });
          }
        } catch (err) {
          this.logger.warn(`HMPanel order sync for ${row.id} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    } finally {
      if (!filter.ids) this.syncing = false;
    }
  }

  private async mustFind(user: AuthUser, id: string) {
    const row = await this.prisma.renewalRequest.findFirst({
      where: { id, brand: brandScope(user) },
      omit: { receiptData: true },
    });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  /** Prefer the panel matched at request time; re-run the lookup if the account moved. */
  private async resolveTarget(row: {
    panelId: string | null;
    clientRef: string | null;
    brandId: string;
    subUrlEnc: string;
  }) {
    if (row.panelId && row.clientRef) {
      const panel = await this.prisma.panelConnection.findUnique({ where: { id: row.panelId } });
      if (panel) return { panel, clientRef: row.clientRef };
    }
    const brand = await this.prisma.brand.findUnique({
      where: { id: row.brandId },
      include: { panels: { select: { id: true } } },
    });
    if (!brand) return null;
    const url = decryptSecret(row.subUrlEnc, this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    const found = await this.lookup.lookup(brand, url).catch(() => null);
    if (!found?.account) return null;
    const panel = await this.prisma.panelConnection.findUnique({ where: { id: found.account.panelId } });
    return panel ? { panel, clientRef: found.account.clientRef } : null;
  }

  private toPublic(r: {
    id: string;
    kind?: string;
    planTitle: string;
    price: string;
    status: RenewalStatus;
    adminNote: string | null;
    subId: string;
    createdAt: Date;
    decidedAt: Date | null;
  }) {
    return {
      id: r.id,
      kind: r.kind ?? 'renewal',
      subId: r.subId,
      planTitle: r.planTitle,
      price: r.price,
      status: r.status.toLowerCase(),
      adminNote: r.adminNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }
}

function parseDataUrl(raw: string): { mime: string; data: Buffer } {
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw || '');
  if (!m) throw new BadRequestException('Attach the receipt as an image');
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) throw new BadRequestException('Receipt must be a JPG, PNG or WebP image');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_RECEIPT_BYTES) throw new BadRequestException('Receipt image is larger than 3 MB');
  if (data.length < 200) throw new BadRequestException('Receipt image is empty');
  return { mime, data };
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HMPanel's store refuses services it did not sell to its own admin; those are reviewed here. */
export function storeCannotRenew(err: unknown) {
  const msg = err instanceof Error ? err.message : '';
  return /service not found for renewal|can only be renewed|can only renew|renewal requires a service/i.test(msg);
}

/** HMPanel wants a Latin config name; it adds the number that makes it unique. */
export function configNameFrom(name: string | null) {
  const latin = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16);
  return latin.length >= 3 ? latin : 'user';
}

function readRefs(json: string | null | undefined): SentReceipt[] {
  try {
    const v = JSON.parse(json || '[]') as SentReceipt[];
    return Array.isArray(v) ? v.filter((r) => r && r.chatId && r.messageId) : [];
  } catch {
    return [];
  }
}
