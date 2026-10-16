import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brand, BrandDomain, PanelConnection, Prisma } from '@prisma/client';
import { lookup } from 'dns/promises';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { brandScope, isOrgAdmin, requireOrgAdmin } from '../common/access/scope';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

export interface RenewalPlan {
  id: string;
  title: string;
  days: number;
  gb: number;
  price: string;
}

export const THEMES = ['mist', 'graphite', 'sage'] as const;

const EDITABLE = [
  'appName', 'shortName', 'tagline', 'logoUrl', 'iconUrl', 'primaryColor', 'accentColor',
  'theme', 'defaultLocale', 'supportUrl', 'supportTelegram', 'contactEmail', 'allowCopyLink',
  'renewalEnabled', 'cardNumber', 'cardHolder', 'bankName', 'renewalNote', 'expiryRemindersEnabled',
  'telegramChatId',
] as const;

export type BrandInput = Partial<Record<(typeof EDITABLE)[number], string | boolean | null>> & {
  slug?: string;
  active?: boolean;
  isDefault?: boolean;
  ownerId?: string | null;
  plans?: RenewalPlan[];
  panelIds?: string[];
  /** Write-only. Empty string clears it. */
  telegramBotToken?: string;
};

type BrandFull = Brand & { domains: BrandDomain[]; panels: Pick<PanelConnection, 'id'>[] };

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  // ---------- public ----------

  /**
   * Resolve the storefront for a request: exact custom domain first, then slug,
   * then the organization's default brand.
   */
  async resolve(tenant?: string | null): Promise<BrandFull | null> {
    const include = { domains: true, panels: { select: { id: true } } };
    const key = normalizeHost(tenant);
    if (key) {
      const byDomain = await this.prisma.brandDomain.findUnique({
        where: { domain: key },
        include: { brand: { include } },
      });
      if (byDomain?.brand.active) return byDomain.brand;
      const bySlug = await this.prisma.brand.findUnique({ where: { slug: key }, include });
      if (bySlug?.active) return bySlug;
    }
    return this.prisma.brand.findFirst({
      where: { active: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include,
    });
  }

  toPublic(b: Brand | null) {
    const plans = b ? parsePlans(b.plansJson) : [];
    const renewal = b?.renewalEnabled && b.cardNumber && plans.length
      ? {
          cardNumber: b.cardNumber,
          cardHolder: b.cardHolder,
          bankName: b.bankName,
          note: b.renewalNote,
          plans,
        }
      : null;
    return {
      slug: b?.slug ?? 'default',
      appName: b?.appName ?? 'NeoConfig',
      shortName: b?.shortName ?? 'NeoConfig',
      tagline: b?.tagline ?? null,
      logoUrl: b?.logoUrl ?? null,
      iconUrl: b?.iconUrl ?? null,
      primaryColor: b?.primaryColor ?? '#4F5BD5',
      accentColor: b?.accentColor ?? '#FF6A1A',
      theme: b?.theme ?? 'mist',
      defaultLocale: b?.defaultLocale ?? 'fa',
      supportUrl: b?.supportUrl ?? null,
      supportTelegram: b?.supportTelegram ?? null,
      contactEmail: b?.contactEmail ?? null,
      allowCopyLink: b?.allowCopyLink ?? true,
      renewal,
    };
  }

  /** Caddy on-demand TLS asks this before issuing a certificate. */
  async isServedDomain(domain: string): Promise<boolean> {
    const host = normalizeHost(domain);
    if (!host) return false;
    const primary = normalizeHost(this.config.get<string>('PRIMARY_DOMAIN'));
    if (primary && host === primary) return true;
    const row = await this.prisma.brandDomain.findUnique({ where: { domain: host } });
    return Boolean(row);
  }

  // ---------- admin ----------

  async list(user: AuthUser) {
    const rows = await this.prisma.brand.findMany({
      where: brandScope(user),
      include: {
        domains: { orderBy: { createdAt: 'asc' } },
        panels: { select: { id: true } },
        owner: { select: { id: true, email: true, name: true } },
        _count: { select: { devices: true, renewals: { where: { status: 'PENDING' } } } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toAdmin(r));
  }

  async get(user: AuthUser, id: string) {
    const row = await this.prisma.brand.findFirst({
      where: { id, ...brandScope(user) },
      include: {
        domains: { orderBy: { createdAt: 'asc' } },
        panels: { select: { id: true } },
        owner: { select: { id: true, email: true, name: true } },
        _count: { select: { devices: true, renewals: { where: { status: 'PENDING' } } } },
      },
    });
    if (!row) throw new NotFoundException('Brand not found');
    return this.toAdmin(row);
  }

  async create(user: AuthUser, input: BrandInput) {
    const orgId = requireOrgAdmin(user);
    const slug = cleanSlug(input.slug || String(input.appName || 'brand'));
    await this.assertSlugFree(slug);
    const count = await this.prisma.brand.count({ where: { orgId } });
    const row = await this.prisma.brand.create({
      data: {
        orgId,
        slug,
        ...this.editable(input),
        plansJson: JSON.stringify(cleanPlans(input.plans ?? [])),
        isDefault: count === 0,
        ownerId: await this.validOwner(orgId, input.ownerId),
        panels: input.panelIds?.length
          ? { connect: await this.validPanels(orgId, input.panelIds) }
          : undefined,
      },
    });
    await this.audit.log({ orgId, userId: user.id, action: 'brand.create', resource: 'brand', resourceId: row.id });
    return this.get(user, row.id);
  }

  async update(user: AuthUser, id: string, input: BrandInput) {
    const brand = await this.mustOwn(user, id);
    const admin = isOrgAdmin(user);
    const data: Prisma.BrandUncheckedUpdateInput = { ...this.editable(input) };

    if (input.plans) data.plansJson = JSON.stringify(cleanPlans(input.plans));
    if (admin) {
      if (input.slug !== undefined) {
        const slug = cleanSlug(input.slug);
        if (slug !== brand.slug) await this.assertSlugFree(slug);
        data.slug = slug;
      }
      if (input.active !== undefined) data.active = Boolean(input.active);
      if (input.ownerId !== undefined) data.ownerId = await this.validOwner(brand.orgId, input.ownerId);
      if (input.panelIds) {
        data.panels = { set: await this.validPanels(brand.orgId, input.panelIds) } as never;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (admin && input.isDefault) {
        await tx.brand.updateMany({ where: { orgId: brand.orgId }, data: { isDefault: false } });
        data.isDefault = true;
      }
      await tx.brand.update({ where: { id }, data });
    });
    await this.audit.log({ orgId: brand.orgId, userId: user.id, action: 'brand.update', resource: 'brand', resourceId: id });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const orgId = requireOrgAdmin(user);
    const brand = await this.mustOwn(user, id);
    const count = await this.prisma.brand.count({ where: { orgId } });
    if (count <= 1) throw new BadRequestException('At least one brand must remain');
    await this.prisma.brand.delete({ where: { id } });
    if (brand.isDefault) {
      const next = await this.prisma.brand.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } });
      if (next) await this.prisma.brand.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await this.audit.log({ orgId, userId: user.id, action: 'brand.delete', resource: 'brand', resourceId: id });
    return { ok: true };
  }

  async addDomain(user: AuthUser, id: string, raw: string) {
    const brand = await this.mustOwn(user, id);
    const domain = normalizeHost(raw);
    if (!domain || !/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
      throw new BadRequestException('Enter a domain like app.example.com');
    }
    const exists = await this.prisma.brandDomain.findUnique({ where: { domain } });
    if (exists) throw new ConflictException('This domain is already connected to a brand');
    await this.prisma.brandDomain.create({ data: { brandId: brand.id, domain } });
    await this.audit.log({ orgId: brand.orgId, userId: user.id, action: 'brand.domain.add', resource: 'brand', resourceId: id, meta: { domain } });
    return this.get(user, id);
  }

  async removeDomain(user: AuthUser, id: string, domainId: string) {
    const brand = await this.mustOwn(user, id);
    await this.prisma.brandDomain.deleteMany({ where: { id: domainId, brandId: brand.id } });
    return this.get(user, id);
  }

  /** DNS must point at this server; HTTPS must answer our health endpoint. */
  async checkDomain(user: AuthUser, id: string, domainId: string) {
    const brand = await this.mustOwn(user, id);
    const row = await this.prisma.brandDomain.findFirst({ where: { id: domainId, brandId: brand.id } });
    if (!row) throw new NotFoundException('Domain not found');

    let dnsOk = false;
    let sslOk = false;
    let message = '';
    const expectedIp = this.config.get<string>('PUBLIC_IP')?.trim();
    try {
      const records = await lookup(row.domain, { all: true });
      const ips = records.map((r) => r.address);
      dnsOk = expectedIp ? ips.includes(expectedIp) : ips.length > 0;
      message = dnsOk
        ? `DNS → ${ips.join(', ')}`
        : `DNS points to ${ips.join(', ') || 'nothing'}${expectedIp ? `, expected ${expectedIp}` : ''}`;
    } catch {
      message = 'No DNS record found for this domain';
    }
    if (dnsOk) {
      try {
        const res = await fetch(`https://${row.domain}/api/v1/health`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        sslOk = res.ok;
        message += sslOk ? ' · HTTPS OK' : ` · HTTPS answered ${res.status}`;
      } catch (err) {
        message += ' · HTTPS not ready yet (certificate is issued on the first visit)';
        void err;
      }
    }
    await this.prisma.brandDomain.update({
      where: { id: row.id },
      data: { dnsOk, sslOk, checkMessage: message, lastCheckAt: new Date() },
    });
    return this.get(user, id);
  }

  async mustOwn(user: AuthUser, id: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id, ...brandScope(user) } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  private editable(input: BrandInput) {
    const out: Record<string, unknown> = {};
    for (const k of EDITABLE) {
      const v = input[k];
      if (v === undefined) continue;
      if (k === 'allowCopyLink' || k === 'renewalEnabled' || k === 'expiryRemindersEnabled') out[k] = Boolean(v);
      else if (k === 'theme') out[k] = THEMES.includes(v as never) ? v : 'mist';
      else if (k === 'primaryColor' || k === 'accentColor') {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v;
      } else if (k === 'appName' || k === 'shortName') {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 60);
      } else if (k === 'telegramChatId') {
        out[k] = typeof v === 'string' ? v.trim().replace(/[^\-\d@A-Za-z_]/g, '').slice(0, 64) || null : null;
      } else if (k === 'cardNumber') {
        out[k] = typeof v === 'string' ? v.replace(/[^\d]/g, '').slice(0, 26) || null : null;
      } else {
        out[k] = typeof v === 'string' ? v.trim().slice(0, 500) || null : null;
      }
    }
    if (input.telegramBotToken !== undefined) {
      const token = input.telegramBotToken.trim();
      if (token && !/^\d+:[\w-]{30,}$/.test(token)) {
        throw new BadRequestException('Telegram bot token looks wrong — copy it from @BotFather');
      }
      out.telegramBotTokenEnc = token
        ? encryptSecret(token, this.config.getOrThrow<string>('ENCRYPTION_KEY'))
        : null;
    }
    return out;
  }

  async telegramTest(user: AuthUser, id: string) {
    const brand = await this.mustOwn(user, id);
    try {
      await this.telegram.test(brand);
    } catch (err) {
      throw new BadRequestException(`Telegram: ${err instanceof Error ? err.message : 'failed'}`);
    }
    return { ok: true };
  }

  private async assertSlugFree(slug: string) {
    if (!slug) throw new BadRequestException('Slug is required');
    const taken = await this.prisma.brand.findUnique({ where: { slug } });
    if (taken) throw new ConflictException('This address is already in use');
  }

  private async validOwner(orgId: string, ownerId?: string | null) {
    if (!ownerId) return null;
    const owner = await this.prisma.user.findFirst({ where: { id: ownerId, orgId } });
    if (!owner) throw new ForbiddenException('Owner must belong to your organization');
    return owner.id;
  }

  private async validPanels(orgId: string, ids: string[]) {
    const rows = await this.prisma.panelConnection.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true },
    });
    return rows;
  }

  private toAdmin(
    r: BrandFull & {
      owner?: { id: string; email: string; name: string | null } | null;
      _count?: { devices: number; renewals: number };
    },
  ) {
    return {
      id: r.id,
      slug: r.slug,
      appName: r.appName,
      shortName: r.shortName,
      tagline: r.tagline,
      logoUrl: r.logoUrl,
      iconUrl: r.iconUrl,
      primaryColor: r.primaryColor,
      accentColor: r.accentColor,
      theme: r.theme,
      defaultLocale: r.defaultLocale,
      supportUrl: r.supportUrl,
      supportTelegram: r.supportTelegram,
      contactEmail: r.contactEmail,
      allowCopyLink: r.allowCopyLink,
      active: r.active,
      isDefault: r.isDefault,
      renewalEnabled: r.renewalEnabled,
      cardNumber: r.cardNumber,
      cardHolder: r.cardHolder,
      bankName: r.bankName,
      renewalNote: r.renewalNote,
      plans: parsePlans(r.plansJson),
      expiryRemindersEnabled: r.expiryRemindersEnabled,
      telegramChatId: r.telegramChatId,
      telegramConfigured: Boolean(r.telegramBotTokenEnc && r.telegramChatId),
      panelIds: r.panels.map((p) => p.id),
      owner: r.owner ?? null,
      domains: r.domains.map((d) => ({
        id: d.id,
        domain: d.domain,
        dnsOk: d.dnsOk,
        sslOk: d.sslOk,
        checkMessage: d.checkMessage,
        lastCheckAt: d.lastCheckAt?.toISOString() ?? null,
      })),
      pendingRenewals: r._count?.renewals ?? 0,
      devices: r._count?.devices ?? 0,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

export function parsePlans(json: string): RenewalPlan[] {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? cleanPlans(arr as RenewalPlan[]) : [];
  } catch {
    return [];
  }
}

function cleanPlans(plans: RenewalPlan[]): RenewalPlan[] {
  return plans
    .filter((p) => p && typeof p.title === 'string' && p.title.trim())
    .slice(0, 12)
    .map((p, i) => ({
      id: String(p.id || `p${i + 1}`).slice(0, 24),
      title: p.title.trim().slice(0, 60),
      days: Math.max(0, Math.min(3650, Math.round(Number(p.days) || 0))),
      gb: Math.max(0, Math.min(100_000, Number(p.gb) || 0)),
      price: String(p.price ?? '').trim().slice(0, 40),
    }));
}

function cleanSlug(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function normalizeHost(raw?: string | null): string | null {
  if (!raw) return null;
  let v = raw.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.$/, '');
  return v || null;
}
