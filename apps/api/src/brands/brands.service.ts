import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brand, BrandDomain, PanelConnection, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { brandScope, isOrgAdmin, requireOrgAdmin } from '../common/access/scope';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { HmPanelCard, HmPanelProduct } from '../integrations/hmpanel/hmpanel.client';
import { PanelGatewayService } from '../panels/panel-gateway.service';
import { compactReminderSettings, parseReminderSettings } from '../push/reminder-settings';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { SslQueueService } from './ssl-queue.service';

export interface RenewalPlan {
  id: string;
  title: string;
  days: number;
  gb: number;
  price: string;
  /** Allowed simultaneous users; 0 = unchanged. */
  users: number;
  /** add = extend time and data; reset = new period, usage zeroed. */
  mode: 'add' | 'reset';
  /** HMPanel store product this plan orders when the brand renews through HMPanel. */
  productId?: string;
  /** HMPanel store category of that product (a service renews only within its category). */
  categoryId?: string;
  /** Only for subscriptions on this NeoConfig panel connection. */
  panelId?: string;
  /** HMPanel: the inner panel of the store product; only its clients see the plan. */
  sourcePanelId?: string;
  sourcePanelName?: string;
  /** Only for this kind of service (3x-ui / PasarGuard); missing = any. */
  service?: 'xui' | 'pasarguard';
  /** Group shown as a tab in the renewal sheet. */
  category?: string;
}

/** Plans as they arrive from the admin form (new fields may be missing). */
export type PlanInput = Omit<RenewalPlan, 'users' | 'mode' | 'service'> & { users?: number; mode?: string; service?: string };

export const THEMES = ['mist', 'graphite', 'sage', 'moss', 'pearl'] as const;
/** App-icon backgrounds the web app knows how to draw (see apps/web/src/lib/themes.ts). */
export const ICON_BGS = ['theme', 'white', 'black', 'brand', 'aurora', 'ocean', 'sunset', 'lime', 'pearl', 'rose', 'night', 'mint'] as const;

/** Themes the customer can switch between: the brand's default first, then the extra choices. */
export function themeList(theme: string, choices: string[] | null | undefined): string[] {
  const valid = (t: string) => THEMES.includes(t as never);
  return [...new Set([valid(theme) ? theme : 'mist', ...(choices ?? []).filter(valid)])];
}

const EDITABLE = [
  'appName', 'shortName', 'tagline', 'logoUrl', 'iconUrl', 'primaryColor', 'accentColor',
  'theme', 'defaultLocale', 'supportUrl', 'supportTelegram', 'contactEmail', 'allowCopyLink',
  'renewalEnabled', 'cardNumber', 'cardHolder', 'bankName', 'renewalNote', 'expiryRemindersEnabled',
  'telegramChatId', 'renewalVia', 'renewalPanelId', 'cardFromPanel', 'hmCardId', 'plansSync', 'purchaseEnabled',
  'autoDecideMinutes', 'autoDecideAction', 'iconBg', 'buttonColor',
] as const;

export type BrandInput = Partial<Record<(typeof EDITABLE)[number], string | boolean | number | null>> & {
  slug?: string;
  active?: boolean;
  isDefault?: boolean;
  ownerId?: string | null;
  plans?: PlanInput[];
  panelIds?: string[];
  themeChoices?: string[];
  copy?: Record<string, string>;
  reminders?: unknown;
  telegramApiBase?: string | null;
  telegramProxy?: string | null;
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
    private readonly ssl: SslQueueService,
    private readonly gateway: PanelGatewayService,
  ) {}

  // ---------- public ----------

  private addBaseCache = new Map<string, { at: number; base: string | null }>();

  /**
   * One-tap "add to the app" link: the brand's own address with the
   * subscription link in the #fragment, which browsers never send to a server.
   */
  async addLink(brandId: string, subUrl: string | null | undefined): Promise<string | null> {
    if (!subUrl || !/^https?:\/\//i.test(subUrl)) return null;
    const hit = this.addBaseCache.get(brandId);
    let base = hit && Date.now() - hit.at < 60_000 ? hit.base : undefined;
    if (base === undefined) {
      const b = await this.prisma.brand.findUnique({
        where: { id: brandId },
        select: { slug: true, isDefault: true, domains: { select: { domain: true, sslOk: true } } },
      });
      const app = (this.config.get<string>('APP_URL') || '').replace(/\/+$/, '');
      const own = b?.domains.find((d) => d.sslOk)?.domain;
      base = !b ? null : own ? `https://${own}/` : app ? (b.isDefault ? `${app}/` : `${app}/b/${b.slug}`) : null;
      this.addBaseCache.set(brandId, { at: Date.now(), base });
    }
    return base ? `${base}#add=${encodeURIComponent(subUrl)}` : null;
  }

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
    // Plans without a price are drafts: kept in the admin, hidden from customers.
    const plans = b
      ? parsePlans(b.plansJson).filter((p) => p.price.trim() && (b.renewalVia !== 'hmpanel' || p.productId))
      : [];
    const renewal = b?.renewalEnabled && (b.cardNumber || (b.cardFromPanel && b.renewalPanelId)) && plans.length
      ? {
          cardNumber: b.cardNumber ?? '',
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
      logoDarkUrl: b?.logoDarkUrl ?? null,
      copy: parseCopy(b?.copyJson),
      iconUrl: b?.iconUrl ?? null,
      primaryColor: b?.primaryColor ?? '#4F5BD5',
      accentColor: b?.accentColor ?? '#FF6A1A',
      theme: b?.theme ?? 'mist',
      themes: themeList(b?.theme ?? 'mist', b?.themeChoices),
      iconBg: b?.iconBg ?? 'theme',
      buttonColor: b?.buttonColor ?? null,
      defaultLocale: b?.defaultLocale ?? 'fa',
      supportUrl: b?.supportUrl ?? null,
      supportTelegram: b?.supportTelegram ?? null,
      contactEmail: b?.contactEmail ?? null,
      allowCopyLink: b?.allowCopyLink ?? true,
      // New services are sold through the HMPanel store, so only store-linked plans qualify.
      purchase: Boolean(b?.purchaseEnabled && b.renewalPanelId && renewal && plans.some((p) => p.productId)),
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
    if (brand.renewalPanelId) this.live.delete(brand.renewalPanelId);
    if (typeof data.renewalPanelId === 'string') {
      const ok =
        isOrgAdmin(user) || (await this.hmpanelPanels(user, id)).some((p) => p.id === data.renewalPanelId)
          ? await this.prisma.panelConnection.findFirst({ where: { id: data.renewalPanelId, orgId: brand.orgId, type: 'hmpanel' } })
          : null;
      if (!ok && data.renewalPanelId === brand.renewalPanelId) {
        // The saved connection was deleted since: drop the link instead of blocking every save.
        data.renewalPanelId = null;
        data.renewalVia = 'local';
        data.cardFromPanel = false;
        data.plansSync = false;
        data.purchaseEnabled = false;
      } else if (!ok) {
        throw new BadRequestException('Choose one of your HMPanel connections');
      }
    }
    if (data.renewalVia === 'hmpanel' && !(data.renewalPanelId ?? brand.renewalPanelId)) {
      throw new BadRequestException('Pick the HMPanel connection before sending renewals to its store');
    }

    if (input.plans) data.plansJson = JSON.stringify(cleanPlans(input.plans));
    // Where the server connects to is an org-level decision; resellers can't point it elsewhere.
    if (isOrgAdmin(user)) {
      if (input.telegramApiBase !== undefined) data.telegramApiBase = cleanRoute(input.telegramApiBase, 'relay');
      if (input.telegramProxy !== undefined) data.telegramProxy = cleanRoute(input.telegramProxy, 'proxy');
    }
    if (input.reminders) data.reminderJson = compactReminderSettings(input.reminders, brand.defaultLocale);
    if (input.copy) data.copyJson = JSON.stringify(parseCopy(JSON.stringify(input.copy)));
    if (input.themeChoices) data.themeChoices = themeList('mist', input.themeChoices).filter((t) => input.themeChoices!.includes(t));
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
    if (input.telegramBotToken !== undefined || input.telegramChatId !== undefined) {
      const fresh = await this.prisma.brand.findUnique({ where: { id } });
      if (fresh) await this.telegram.registerWebhook(fresh).catch(() => undefined);
    }
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
    // Start on the certificate right away; it succeeds once DNS points here.
    await this.ssl.request(domain, 'issue');
    return this.get(user, id);
  }

  async removeDomain(user: AuthUser, id: string, domainId: string) {
    const brand = await this.mustOwn(user, id);
    const row = await this.prisma.brandDomain.findFirst({ where: { id: domainId, brandId: brand.id } });
    if (row) {
      await this.prisma.brandDomain.delete({ where: { id: row.id } });
      await this.ssl.request(row.domain, 'remove');
    }
    return this.get(user, id);
  }

  /** Ask the host for a (new) Let's Encrypt certificate for this domain. */
  async issueSsl(user: AuthUser, id: string, domainId: string) {
    const brand = await this.mustOwn(user, id);
    const row = await this.prisma.brandDomain.findFirst({ where: { id: domainId, brandId: brand.id } });
    if (!row) throw new NotFoundException('Domain not found');
    if (!this.ssl.enabled) {
      throw new BadRequestException('Automatic SSL is only available on servers installed with the NeoConfig installer');
    }
    await this.ssl.request(row.domain, 'issue');
    await this.prisma.brandDomain.update({
      where: { id: row.id },
      data: { sslOk: false, checkMessage: 'Certificate requested — this takes up to a minute', lastCheckAt: new Date() },
    });
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
    if (dnsOk && this.ssl.enabled) {
      const result = await this.ssl.result(row.domain);
      if (await this.ssl.isPending(row.domain)) {
        message += ' · Certificate is being issued…';
      } else if (result?.ok) {
        message += ` · ${result.message}`;
      } else if (result) {
        message += ` · SSL failed: ${result.message}`;
      } else {
        await this.ssl.request(row.domain, 'issue');
        message += ' · Certificate requested';
      }
    }
    if (dnsOk) {
      try {
        const res = await fetch(`https://${row.domain}/api/v1/health`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        sslOk = res.ok;
        message += sslOk ? ' · HTTPS OK' : ` · HTTPS answered ${res.status}`;
      } catch {
        if (!this.ssl.enabled) message += ' · HTTPS not reachable yet';
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
      if (k === 'allowCopyLink' || k === 'renewalEnabled' || k === 'expiryRemindersEnabled' || k === 'cardFromPanel' || k === 'plansSync' || k === 'purchaseEnabled')
        out[k] = Boolean(v);
      else if (k === 'theme') out[k] = THEMES.includes(v as never) ? v : 'mist';
      else if (k === 'renewalVia') out[k] = v === 'hmpanel' ? 'hmpanel' : 'local';
      else if (k === 'iconBg') out[k] = typeof v === 'string' && ICON_BGS.includes(v as never) ? v : 'theme';
      else if (k === 'buttonColor') out[k] = typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
      else if (k === 'autoDecideAction') out[k] = v === 'reject' ? 'reject' : 'approve';
      else if (k === 'autoDecideMinutes') out[k] = Math.max(0, Math.min(10_080, Math.round(Number(v) || 0)));
      else if (k === 'renewalPanelId') out[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
      else if (k === 'primaryColor' || k === 'accentColor') {
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v;
      } else if (k === 'appName' || k === 'shortName') {
        if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 60);
      } else if (k === 'telegramChatId') {
        // Admins' numeric IDs, comma separated (a legacy group/channel ID or @name still works).
        out[k] =
          typeof v === 'string'
            ? v
                .split(/[\s,،]+/)
                .map((x) => x.replace(/[^\-\d@A-Za-z_]/g, ''))
                .filter(Boolean)
                .slice(0, 10)
                .join(',') || null
            : null;
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
      out.telegramWebhookSecret = token ? randomBytes(24).toString('hex') : null;
    }
    return out;
  }

  /** Logo as a data URL (PNG/JPEG/WebP ≤512 KB); served from our own origin. */
  /** variant light: the default logo (shown on light themes). dark: a light-colored logo for dark themes. */
  async uploadLogo(user: AuthUser, id: string, dataUrl: string, variant: 'light' | 'dark' = 'light') {
    const brand = await this.mustOwn(user, id);
    const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) throw new BadRequestException('Upload a PNG, JPEG or WebP image');
    const data = Buffer.from(m[3], 'base64');
    if (data.length > 512 * 1024) throw new BadRequestException('Logo must be under 512 KB');
    const v = Date.now().toString(36);
    await this.prisma.brand.update({
      where: { id: brand.id },
      data:
        variant === 'dark'
          ? { logoDarkData: new Uint8Array(data), logoDarkMime: m[1], logoDarkUrl: `/api/v1/public/brands/${brand.slug}/logo-dark?v=${v}` }
          : { logoData: new Uint8Array(data), logoMime: m[1], logoUrl: `/api/v1/public/brands/${brand.slug}/logo?v=${v}` },
    });
    return this.get(user, id);
  }

  async removeLogo(user: AuthUser, id: string, variant: 'light' | 'dark' = 'light') {
    const brand = await this.mustOwn(user, id);
    await this.prisma.brand.update({
      where: { id: brand.id },
      data: variant === 'dark' ? { logoDarkData: null, logoDarkMime: null, logoDarkUrl: null } : { logoData: null, logoMime: null, logoUrl: null },
    });
    return this.get(user, id);
  }

  async logo(slug: string, variant: 'light' | 'dark' = 'light') {
    const b = await this.prisma.brand.findUnique({
      where: { slug },
      select: { logoData: true, logoMime: true, logoDarkData: true, logoDarkMime: true },
    });
    if (!b) return null;
    if (variant === 'dark') return b.logoDarkData && b.logoDarkMime ? { data: Buffer.from(b.logoDarkData), mime: b.logoDarkMime } : null;
    return b.logoData && b.logoMime ? { data: Buffer.from(b.logoData), mime: b.logoMime } : null;
  }

  // ---------- HMPanel store ----------

  /** The panels a brand's plans can be limited to (names and types only; resellers may see these). */
  async brandPanels(user: AuthUser, id: string) {
    const brand = await this.mustOwn(user, id);
    const own = await this.prisma.brand.findUnique({ where: { id }, select: { panels: { select: { id: true } } } });
    const ids = own?.panels.map((p) => p.id) ?? [];
    const rows = await this.prisma.panelConnection.findMany({
      where: { orgId: brand.orgId, ...(ids.length ? { id: { in: ids } } : {}) },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    return rows;
  }

  /** HMPanel connections this brand may use (its own panels, or the org's when none are picked). */
  async hmpanelPanels(user: AuthUser, id: string) {
    const brand = await this.mustOwn(user, id);
    const own = await this.prisma.brand.findUnique({ where: { id }, select: { panels: { select: { id: true } } } });
    const ids = own?.panels.map((p) => p.id) ?? [];
    // A reseller works only with the connections an admin gave their brand (their own HMPanel key),
    // so renewals come out of their own quota and they never see the org's other stores.
    if (!isOrgAdmin(user) && !ids.length) return [];
    const panels = await this.prisma.panelConnection.findMany({
      where: { orgId: brand.orgId, type: 'hmpanel', ...(isOrgAdmin(user) ? {} : { id: { in: ids } }) },
      select: { id: true, name: true, baseUrl: true, lastTestOk: true },
      orderBy: { name: 'asc' },
    });
    // inBrand=false: the brand searches only its picked panels, and this one isn't among them.
    return panels.map((p) => ({
      id: p.id,
      name: p.name,
      host: safeHost(p.baseUrl),
      healthy: p.lastTestOk,
      inBrand: !ids.length || ids.includes(p.id),
    }));
  }

  private async hmpanelFor(user: AuthUser, id: string, panelId: string) {
    const allowed = await this.hmpanelPanels(user, id);
    if (!allowed.some((p) => p.id === panelId)) throw new NotFoundException('HMPanel connection not found for this brand');
    const row = await this.prisma.panelConnection.findUnique({ where: { id: panelId } });
    if (!row) throw new NotFoundException('HMPanel connection not found');
    return this.gateway.hmStore(row);
  }

  /** Everything the HMPanel tab shows at once; each part fails on its own. */
  async hmpanelOverview(user: AuthUser, id: string, panelId: string) {
    const store = await this.hmpanelFor(user, id, panelId);
    const part = async <T>(fn: () => Promise<T>) => {
      try {
        return { ok: true as const, data: await fn() };
      } catch (err) {
        return { ok: false as const, error: hmError(err) };
      }
    };
    const [account, premium, shop, cards, products, categories] = await Promise.all([
      part(store.account),
      part(store.premium),
      part(store.store),
      part(store.cards),
      part(async () => (await store.products()).filter((p) => p.renewable && p.status === 'active' && !p.isTest)),
      part(store.categories),
    ]);
    return { account, premium, store: shop, cards, products, categories };
  }

  // ---------- live HMPanel data for the storefront ----------

  private live = new Map<string, { at: number; cards: HmPanelCard[] | null; products: HmPanelProduct[] | null }>();

  private async liveFor(panelId: string) {
    const hit = this.live.get(panelId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit;
    const row = await this.prisma.panelConnection.findUnique({ where: { id: panelId } });
    if (!row || row.type !== 'hmpanel') return { at: Date.now(), cards: null, products: null };
    const store = this.gateway.hmStore(row);
    const [cards, products] = await Promise.all([store.cards().catch(() => null), store.products().catch(() => null)]);
    // Keep the last good answer if HMPanel is briefly unreachable.
    const entry = { at: Date.now(), cards: cards ?? hit?.cards ?? null, products: products ?? hit?.products ?? null };
    this.live.set(panelId, entry);
    return entry;
  }

  private categoryCache = new Map<string, { at: number; categoryId: string | null }>();

  /**
   * The store category an HMPanel service is locked to: the category of the
   * product on its latest delivered order. null when it was never sold through
   * the store (then any plan may renew it). Cached 10 minutes.
   */
  async serviceCategory(panelId: string, clientRef: string, email: string | null | undefined): Promise<string | null> {
    if (!email) return null;
    const key = `${panelId}:${clientRef}`;
    const hit = this.categoryCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.categoryId;
    const row = await this.prisma.panelConnection.findUnique({ where: { id: panelId } });
    if (!row || row.type !== 'hmpanel') return null;
    const store = this.gateway.hmStore(row);
    let categoryId: string | null = null;
    try {
      const orders = await store.orders(email);
      const delivered = orders
        .filter((o) => o.client?.id === clientRef && ['ACTIVE', 'RENEWED', 'APPROVED', 'PROVISIONING'].includes(o.status) && o.product?.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (delivered[0]) {
        const live = await this.liveFor(panelId);
        categoryId = live.products?.find((p) => p.id === delivered[0].product!.id)?.category?.id ?? null;
      }
    } catch {
      return hit?.categoryId ?? null;
    }
    this.categoryCache.set(key, { at: Date.now(), categoryId });
    return categoryId;
  }

  /** Public branding with the HMPanel card and product prices filled in live (cached 5 min). */
  async toPublicLive(b: Brand | null) {
    const pub = this.toPublic(b);
    if (!b?.renewalPanelId || !pub.renewal || (!b.cardFromPanel && !b.plansSync)) return pub;
    const live = await this.liveFor(b.renewalPanelId).catch(() => null);
    if (!live) return b.cardNumber ? pub : { ...pub, renewal: null };
    let renewal = pub.renewal;
    if (b.cardFromPanel) {
      const card = live.cards?.find((c) => c.id === b.hmCardId) ?? live.cards?.[0];
      if (card) renewal = { ...renewal, cardNumber: card.cardNumber.replace(/\D/g, ''), cardHolder: card.cardHolder, bankName: card.bankName };
      else if (!b.cardNumber) return { ...pub, renewal: null };
    }
    if (b.plansSync && live.products) {
      const byId = new Map(live.products.map((p) => [p.id, p]));
      renewal = {
        ...renewal,
        plans: renewal.plans.flatMap((plan) => {
          if (!plan.productId) return [plan];
          const p = byId.get(plan.productId);
          if (!p || !p.renewable || p.status !== 'active') return [];
          return [
            {
              ...plan,
              days: p.durationDays,
              gb: p.trafficBytes > 0 ? +(p.trafficBytes / 1024 ** 3).toFixed(2) : 0,
              price: p.priceToman ? `${p.priceToman.toLocaleString('fa-IR')} تومان` : plan.price,
            },
          ];
        }),
      };
      if (!renewal.plans.length) return { ...pub, renewal: null };
    }
    return { ...pub, renewal };
  }

  async hmpanelCards(user: AuthUser, id: string, panelId: string) {
    const store = await this.hmpanelFor(user, id, panelId);
    try {
      return await store.cards();
    } catch (err) {
      throw new BadRequestException(hmError(err));
    }
  }

  async hmpanelProducts(user: AuthUser, id: string, panelId: string) {
    const store = await this.hmpanelFor(user, id, panelId);
    try {
      const products = await store.products();
      return products.filter((p) => p.renewable && p.status === 'active' && !p.isTest);
    } catch (err) {
      throw new BadRequestException(hmError(err));
    }
  }

  async telegramTest(user: AuthUser, id: string) {
    const brand = await this.mustOwn(user, id);
    let delivered: { ok: number; errors: string[] };
    try {
      delivered = await this.telegram.test(brand);
    } catch (err) {
      throw new BadRequestException(`Telegram: ${err instanceof Error ? err.message : 'failed'}`);
    }
    // Re-register so the Approve/Reject buttons work (also repairs a changed APP_URL).
    const hook = await this.telegram.registerWebhook(brand);
    return { ok: true, delivered: delivered.ok, errors: delivered.errors, buttons: hook.ok, buttonsMessage: hook.message };
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
      logoDarkUrl: r.logoDarkUrl,
      copy: parseCopy(r.copyJson),
      reminders: parseReminderSettings(r.reminderJson, r.defaultLocale),
      iconUrl: r.iconUrl,
      primaryColor: r.primaryColor,
      accentColor: r.accentColor,
      theme: r.theme,
      themeChoices: r.themeChoices,
      iconBg: r.iconBg,
      buttonColor: r.buttonColor,
      renewalVia: r.renewalVia,
      renewalPanelId: r.renewalPanelId,
      cardFromPanel: r.cardFromPanel,
      hmCardId: r.hmCardId,
      plansSync: r.plansSync,
      purchaseEnabled: r.purchaseEnabled,
      autoDecideMinutes: r.autoDecideMinutes,
      autoDecideAction: r.autoDecideAction,
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
      telegramHasToken: Boolean(r.telegramBotTokenEnc),
      telegramApiBase: r.telegramApiBase,
      telegramProxy: r.telegramProxy,
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
    return Array.isArray(arr) ? cleanPlans(arr as PlanInput[]) : [];
  } catch {
    return [];
  }
}

function cleanPlans(plans: PlanInput[]): RenewalPlan[] {
  return plans
    .filter((p) => p && typeof p.title === 'string' && p.title.trim())
    .slice(0, 12)
    .map((p, i) => ({
      id: String(p.id || `p${i + 1}`).slice(0, 24),
      title: p.title.trim().slice(0, 60),
      days: Math.max(0, Math.min(3650, Math.round(Number(p.days) || 0))),
      gb: Math.max(0, Math.min(100_000, Number(p.gb) || 0)),
      price: String(p.price ?? '').trim().slice(0, 40),
      users: Math.max(0, Math.min(20, Math.round(Number(p.users) || 0))),
      mode: p.mode === 'reset' ? 'reset' : 'add',
      ...(typeof p.productId === 'string' && p.productId.trim() ? { productId: p.productId.trim().slice(0, 64) } : {}),
      ...(p.service === 'xui' || p.service === 'pasarguard' ? { service: p.service } : {}),
      ...(typeof p.categoryId === 'string' && p.categoryId.trim() ? { categoryId: p.categoryId.trim().slice(0, 64) } : {}),
      ...(typeof p.panelId === 'string' && p.panelId.trim() ? { panelId: p.panelId.trim().slice(0, 64) } : {}),
      ...(typeof p.sourcePanelId === 'string' && p.sourcePanelId.trim() ? { sourcePanelId: p.sourcePanelId.trim().slice(0, 64) } : {}),
      ...(typeof p.sourcePanelName === 'string' && p.sourcePanelName.trim() ? { sourcePanelName: p.sourcePanelName.trim().slice(0, 60) } : {}),
      ...(typeof p.category === 'string' && p.category.trim() ? { category: p.category.trim().slice(0, 40) } : {}),
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

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** HMPanel store errors in words an admin can act on. */
export function hmError(err: unknown) {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : 'HMPanel request failed';
  if (status === 404) return 'HMPanel premium store is not installed on this panel';
  if (status === 403) return `HMPanel refused: ${msg} (needs an active Premium license, the store module and the store.* scopes)`;
  if (status === 401) return 'HMPanel rejected the API key';
  return msg;
}

/** Texts a brand may reword on the first screen and the intro; anything else is dropped. */
export const COPY_KEYS = [
  'onboardTitle', 'onboardBody',
  'introWelcomeA', 'introWelcomeB', 'introWelcomeBody',
  'introInstallA', 'introInstallB', 'introInstallBody',
  'introNotifyA', 'introNotifyB', 'introNotifyBody',
] as const;

export function parseCopy(json: string | null | undefined): Record<string, string> {
  try {
    const raw = JSON.parse(json || '{}') as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of COPY_KEYS) {
      const v = raw?.[k];
      if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, k.endsWith('Body') ? 240 : 60);
    }
    return out;
  } catch {
    return {};
  }
}

/** A Telegram relay (https URL) or HTTP proxy (http[s]://host:port); empty clears it. */
function cleanRoute(v: string | null | undefined, kind: 'relay' | 'proxy'): string | null {
  const raw = (v || '').trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException(kind === 'relay' ? 'Relay must be a full https:// address' : 'Proxy must look like http://127.0.0.1:10809');
  }
  if (kind === 'relay' && u.protocol !== 'https:') throw new BadRequestException('Relay must use https://');
  if (kind === 'proxy' && !['http:', 'https:'].includes(u.protocol)) throw new BadRequestException('Only HTTP proxies are supported (http://host:port)');
  return raw.replace(/\/+$/, '').slice(0, 200);
}
