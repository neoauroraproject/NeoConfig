import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RenewalStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { BrandsService, parsePlans } from '../brands/brands.service';
import { brandScope } from '../common/access/scope';
import { decryptSecret, encryptSecret } from '../common/crypto/secret.crypto';
import { PanelGatewayService } from '../panels/panel-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';
import { PushService } from '../push/push.service';

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
    const plan = parsePlans(brand.plansJson).find((p) => p.id === input.planId);
    if (!plan) throw new BadRequestException('Choose one of the listed plans');

    const { mime, data } = parseDataUrl(input.receipt);

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
        price: plan.price,
        payerName: input.payerName?.trim().slice(0, 80) || null,
        payerNote: input.payerNote?.trim().slice(0, 300) || null,
        receiptMime: mime,
        receiptData: new Uint8Array(data),
        deviceEndpoint: input.deviceEndpoint?.slice(0, 1024) || null,
      },
    });
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
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');

    let appliedOnPanel: boolean | null = null;
    let applyMessage: string | null = null;
    if (opts.apply) {
      const target = await this.resolveTarget(row);
      if (!target) {
        throw new BadRequestException('Account not found on any panel. Approve without applying and renew it manually.');
      }
      const res = await this.gateway.renew(target.panel, target.clientRef, { days: row.days, gb: row.gb });
      appliedOnPanel = res.ok;
      applyMessage = res.message;
      if (!res.ok) {
        // Stay pending so the admin can retry or approve without applying.
        await this.prisma.renewalRequest.update({ where: { id }, data: { appliedOnPanel, applyMessage } });
        throw new BadRequestException(`Panel did not accept the renewal: ${res.message}`);
      }
    }

    await this.prisma.renewalRequest.update({
      where: { id },
      data: {
        status: RenewalStatus.APPROVED,
        adminNote: opts.note?.trim().slice(0, 300) || null,
        appliedOnPanel,
        applyMessage,
        decidedAt: new Date(),
        decidedById: user.id,
      },
    });
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
      userId: user.id,
      action: 'renewal.approve',
      resource: 'renewal',
      resourceId: id,
      meta: { appliedOnPanel },
    });
    return { ok: true, appliedOnPanel, applyMessage, notified: push.sent };
  }

  async reject(user: AuthUser, id: string, note?: string) {
    const row = await this.mustFind(user, id);
    if (row.status !== RenewalStatus.PENDING) throw new BadRequestException('Already decided');
    await this.prisma.renewalRequest.update({
      where: { id },
      data: {
        status: RenewalStatus.REJECTED,
        adminNote: note?.trim().slice(0, 300) || null,
        decidedAt: new Date(),
        decidedById: user.id,
      },
    });
    const push = await this.push.notifySubscription(
      row.brandId,
      row.subId,
      {
        title: 'درخواست تمدید تأیید نشد',
        body: note?.trim() || 'پرداخت شما تأیید نشد. برای جزئیات برنامه را باز کنید.',
        url: '/',
        tag: `renewal-${row.id}`,
      },
      row.deviceEndpoint,
    );
    await this.audit.log({ orgId: row.orgId, userId: user.id, action: 'renewal.reject', resource: 'renewal', resourceId: id });
    return { ok: true, notified: push.sent };
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
