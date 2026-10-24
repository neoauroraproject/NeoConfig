import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Brand } from '@prisma/client';
import { BrandsService } from '../brands/brands.service';
import { parseConfigLink } from '../common/config-link';
import { redactUrl } from '../common/crypto/secret.crypto';
import { assertPublicHttpUrl, resolveAndAssertPublic, SsrfError } from '../common/ssrf/ssrf.guard';
import { PasarGuardClientService } from '../integrations/pasarguard/pasarguard.client';
import { normalizeFromSubInfo, normalizeFromUserInfoHeaders } from '../integrations/xui/normalize';
import { NormalizedSubscription } from '../integrations/xui/types';
import { XuiClientService } from '../integrations/xui/xui.client';
import { FoundAccount, PanelGatewayService } from '../panels/panel-gateway.service';
import { PrismaService } from '../prisma/prisma.service';

export interface LookupResult {
  subId: string | null;
  redactedUrl: string;
  snapshot: NormalizedSubscription;
  online: boolean | null;
  lastOnlineAt: string | null;
  renewable: boolean;
  deviceLimit: number | null;
  devicesOnline: number | null;
  devicesRegistered: number | null;
  deviceMode: 'hwid' | 'ip' | null;
  serviceKind: 'xui' | 'pasarguard' | null;
  /** Present only when the account was matched on a configured panel. */
  account: FoundAccount | null;
}

const NOT_FOUND =
  'We could not find this subscription. Check the link, or ask support to confirm it is still active.';

/** Calendar day where the customers are (daily usage is a local-day idea). */
export function usageDay(now = new Date(), timeZone = process.env.USAGE_TIMEZONE || 'Asia/Tehran') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
    private readonly gateway: PanelGatewayService,
    private readonly xui: XuiClientService,
    private readonly pasarguard: PasarGuardClientService,
  ) {}

  async branding(tenant?: string) {
    return this.brands.toPublicLive(await this.brands.resolve(tenant));
  }

  async lookupForTenant(input: string, tenant?: string) {
    const brand = await this.brands.resolve(tenant);
    if (!brand) throw new NotFoundException('No storefront is configured yet');
    let url: string;
    let result: LookupResult;
    try {
      url = await this.resolveInput(brand, input);
      result = await this.lookup(brand, url);
    } catch (err) {
      if (err instanceof NotFoundException) this.logLookup(brand.id, false, 'none');
      throw err;
    }
    this.logLookup(brand.id, true, result.snapshot.dataSource);
    const key = result.subId ?? result.snapshot.subscriptionId;
    await this.recordUsage(brand.id, key, result.snapshot.totalUsedBytes);
    const history = await this.usageHistory(brand.id, key).catch(() => []);
    const account = result.account;
    // HMPanel store services renew only with plans from their own store category.
    const storeCategoryId =
      brand.renewalPanelId && account?.panelId === brand.renewalPanelId && account.panelType === 'hmpanel'
        ? await this.brands.serviceCategory(brand.renewalPanelId, account.clientRef, account.clientEmail).catch(() => null)
        : null;
    const { account: _account, ...publicPart } = result;
    return {
      ...publicPart,
      // The link the app should keep — the subscription link when a config was pasted.
      url,
      history,
      storeCategoryId,
      // Which panel the subscription lives on, so the app offers that panel's plans.
      panelId: account?.panelId ?? null,
      sourcePanelRef: account?.sourcePanelRef ?? null,
      renewable: Boolean(account?.renewable && brand.renewalEnabled),
    };
  }

  /** Keep today's latest reading; called from lookups and from the reminder pass. */
  async recordUsage(brandId: string, subId: string, usedBytes: number | null) {
    if (usedBytes === null || !Number.isFinite(usedBytes) || usedBytes < 0 || !subId) return;
    const day = usageDay();
    const value = BigInt(Math.round(usedBytes));
    await this.prisma.usageDay
      .upsert({
        where: { brandId_subId_day: { brandId, subId, day } },
        create: { brandId, subId, day, usedBytes: value },
        update: { usedBytes: value },
      })
      .catch(() => undefined);
  }

  async usageHistory(brandId: string, subId: string, days = 30) {
    const rows = await this.prisma.usageDay.findMany({
      where: { brandId, subId },
      orderBy: { day: 'desc' },
      take: days,
      select: { day: true, usedBytes: true },
    });
    return rows.reverse().map((r) => ({ d: r.day, used: Number(r.usedBytes) }));
  }

  private logLookup(brandId: string, found: boolean, source: string) {
    void this.prisma.lookupEvent.create({ data: { brandId, found, source } }).catch(() => undefined);
  }

  /**
   * A pasted config stands in for its subscription link: the uuid / password in
   * it finds the client on the brand's panels, and with it the real link.
   */
  private async resolveInput(brand: Brand & { panels: { id: string }[] }, input: string): Promise<string> {
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) return text;
    const cred = parseConfigLink(text);
    if (!cred) throw new BadRequestException('Paste your subscription link');
    for (const panel of await this.brandPanels(brand, cred.host)) {
      const url = await this.gateway.subscriptionUrlForCredential(panel, cred.key);
      if (url) return url;
    }
    throw new NotFoundException(NOT_FOUND);
  }

  /**
   * Strict brands accept only subscriptions found on their own panels: a
   * reseller's storefront never reads other links or searches the org's other
   * panels (whose keys may be the owner's full-access ones).
   */
  private async isStrict(brand: Brand) {
    if (brand.strictLookup) return true;
    if (!brand.ownerId) return false;
    const owner = await this.prisma.user.findUnique({ where: { id: brand.ownerId }, select: { role: true } }).catch(() => null);
    return owner?.role === 'RESELLER';
  }

  /** The brand's panels, the ones on `host` first (the likeliest match). */
  private async brandPanels(brand: Brand & { panels: { id: string }[] }, host: string | null) {
    const panelIds = brand.panels.map((p) => p.id);
    if (!panelIds.length && (await this.isStrict(brand))) return [];
    const panels = await this.prisma.panelConnection.findMany({
      where: panelIds.length ? { id: { in: panelIds } } : { orgId: brand.orgId },
      orderBy: { createdAt: 'asc' },
    });
    return panels.sort((a, b) => sameHost(b.baseUrl, host) - sameHost(a.baseUrl, host));
  }

  /**
   * Find the account behind a subscription link: search the brand's panels by
   * the subId in the URL (or the PasarGuard token), then fall back to the
   * subscription endpoint's own metadata.
   */
  async lookup(brand: Brand & { panels: { id: string }[] }, url: string): Promise<LookupResult> {
    const parsed = this.parseUrl(url);
    const subId = extractSubId(url);

    for (const panel of await this.brandPanels(brand, parsed.hostname)) {
      const found = await this.gateway.find(panel, url, subId);
      if (found) {
        return {
          subId: found.clientRef,
          redactedUrl: redactUrl(url),
          snapshot: found.snapshot,
          online: found.online,
          lastOnlineAt: found.lastOnlineAt,
          renewable: found.renewable,
          deviceLimit: found.deviceLimit ?? null,
          devicesOnline: found.devicesOnline ?? null,
          devicesRegistered: found.devicesRegistered ?? null,
          deviceMode: found.deviceMode ?? null,
          serviceKind: found.serviceKind ?? null,
          account: found,
        };
      }
    }

    // A strict brand never takes a link its own panels don't know.
    if (await this.isStrict(brand)) throw new NotFoundException(NOT_FOUND);
    // Only now do we fetch the link itself, so only now does it need the DNS/SSRF check.
    await this.assertFetchable(parsed);
    const fallback = await this.fromSubscriptionEndpoint(url, subId);
    if (!fallback) {
      throw new NotFoundException(NOT_FOUND);
    }
    return {
      subId: subId ?? fallback.snapshot.subscriptionId,
      redactedUrl: redactUrl(url),
      snapshot: fallback.snapshot,
      online: fallback.online,
      lastOnlineAt: fallback.lastOnlineAt,
      renewable: false,
      deviceLimit: null,
      devicesOnline: null,
      devicesRegistered: null,
      deviceMode: null,
      serviceKind: null,
      account: null,
    };
  }

  private async fromSubscriptionEndpoint(url: string, subId: string | null) {
    const pg = await this.pasarguard.fetchPublicInfo(url).catch(() => null);
    if (pg) return pg;
    try {
      const { info, userInfo } = await this.xui.fetchSubscriptionInfo(url);
      const snapshot = info
        ? normalizeFromSubInfo(info, userInfo)
        : userInfo
          ? normalizeFromUserInfoHeaders(userInfo, subId ?? undefined)
          : null;
      if (!snapshot) return null;
      // Without panel access the link only knows its id; the config remark is the name people recognise.
      const generic = !info?.email && (snapshot.displayName === 'Subscription' || snapshot.displayName === subId);
      if (generic) {
        const remark = await this.xui.fetchRemark(url).catch(() => null);
        if (remark) snapshot.displayName = remark;
      }
      return { snapshot, online: null, lastOnlineAt: null };
    } catch {
      return null;
    }
  }

  private parseUrl(url: string): URL {
    try {
      return assertPublicHttpUrl(url);
    } catch (err) {
      if (err instanceof SsrfError) throw new ForbiddenException(err.message);
      throw err;
    }
  }

  private async assertFetchable(parsed: URL) {
    try {
      await resolveAndAssertPublic(parsed);
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new NotFoundException(NOT_FOUND);
      }
      throw err;
    }
  }
}

function sameHost(base: string, host: string | null): number {
  try {
    return host && new URL(base).hostname === host ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Last meaningful path segment: `/sub/abc123` → `abc123`, `/sub/tok/v2ray` → `tok`. */
export function extractSubId(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const skip = new Set(['info', 'raw', 'v2ray', 'clash', 'clash_meta', 'sing_box', 'xray', 'json', 'links', 'outline']);
    while (parts.length > 1 && skip.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    const last = parts[parts.length - 1];
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}
