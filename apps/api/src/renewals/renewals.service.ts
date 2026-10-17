import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RenewalRequest, RenewalStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { BrandsService, parsePlans } from '../brands/brands.service';
import { brandScope } from '../common/access/scope';
import { decryptSecret, encryptSecret } from '../common/crypto/secret.crypto';
import { PanelGatewayService } from '../panels/panel-gateway.service';
import { describeTerms, normalizeTerms } from '../panels/renewal-terms';
import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';
import { PushService } from '../push/push.service';
import { ReviewInfo, TelegramService } from '../telegram/telegram.service';

type RenewalRow = Omit<RenewalRequest, 'receiptData'>;

const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class RenewalsService {
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
        panelId: found.account?.panelId ?? null,
        clientRef: found.account?.clientRef ?? null,
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
    void this.review(row, found.snapshot)
      .then((review) => this.telegram.renewalReceived(brand, { ...row, review }, { mime, data }))
      .catch(() => undefined);
    return this.toPublic(row);
  }

  async statuses(ids: string[]) {
    const rows = await this.prisma.renewalRequest.findMany({
      where: { id: { in: ids.slice(0, 30) } },
      omit: { receiptData: true, subUrlEnc: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
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
      appliedOnPanel: r.appliedOnPanel,
      applyMessage: r.applyMessage,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
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
      await this.telegram.renewalReceived(brand, { ...row, review }, { mime: row.receiptMime, data: Buffer.from(row.receiptData) });
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
    return {
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
    opts: { apply: boolean; note?: string; by: string; userId: string | null; telegramOrigin: boolean },
  ) {
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');
    const terms = normalizeTerms({ days: row.days, gb: row.gb, users: row.users, mode: row.mode as 'add' | 'reset' });
    let appliedOnPanel: boolean | null = null;
    let applyMessage: string | null = null;
    if (opts.apply) {
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
        adminNote: opts.note?.trim().slice(0, 300) || null,
        appliedOnPanel,
        applyMessage,
        decidedAt: new Date(),
        decidedById: opts.userId,
      },
    });
    if (!opts.telegramOrigin) void this.notifyTeam(row, { approved: true, by: opts.by, appliedOnPanel, note: opts.note });
    const push = await this.push.notifySubscription(
      row.brandId,
      row.subId,
      {
        title: 'تمدید انجام شد',
        body: `${row.planTitle} روی اشتراک شما فعال شد.`,
        url: '/',
        tag: `renewal-${row.id}`,
      },
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
    opts: { note?: string; by: string; userId: string | null; telegramOrigin: boolean },
  ) {
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');
    await this.prisma.renewalRequest.update({
      where: { id: row.id },
      data: {
        status: RenewalStatus.REJECTED,
        adminNote: opts.note?.trim().slice(0, 300) || null,
        decidedAt: new Date(),
        decidedById: opts.userId,
      },
    });
    if (!opts.telegramOrigin) void this.notifyTeam(row, { approved: false, by: opts.by, appliedOnPanel: null, note: opts.note });
    const push = await this.push.notifySubscription(
      row.brandId,
      row.subId,
      {
        title: 'درخواست تمدید تأیید نشد',
        body: opts.note?.trim() || 'پرداخت شما تأیید نشد. برای جزئیات برنامه را باز کنید.',
        url: '/',
        tag: `renewal-${row.id}`,
      },
      row.deviceEndpoint,
    );
    await this.audit.log({ orgId: row.orgId, userId: opts.userId, action: 'renewal.reject', resource: 'renewal', resourceId: row.id, meta: { by: opts.by } });
    return { ok: true, notified: push.sent };
  }

  private async notifyTeam(
    row: { brandId: string; displayName: string | null; subId: string; planTitle: string },
    decision: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null },
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: row.brandId } }).catch(() => null);
    if (brand && this.telegram.isConfigured(brand)) {
      await this.telegram.renewalDecided(brand, row, decision).catch(() => undefined);
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
