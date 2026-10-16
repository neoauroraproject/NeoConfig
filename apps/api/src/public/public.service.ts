import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Brand } from '@prisma/client';
import { BrandsService } from '../brands/brands.service';
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
  /** Present only when the account was matched on a configured panel. */
  account: FoundAccount | null;
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
    return this.brands.toPublic(await this.brands.resolve(tenant));
  }

  async lookupForTenant(url: string, tenant?: string) {
    const brand = await this.brands.resolve(tenant);
    if (!brand) throw new NotFoundException('No storefront is configured yet');
    let result: LookupResult;
    try {
      result = await this.lookup(brand, url);
    } catch (err) {
      if (err instanceof NotFoundException) this.logLookup(brand.id, false, 'none');
      throw err;
    }
    this.logLookup(brand.id, true, result.snapshot.dataSource);
    const { account, ...publicPart } = result;
    return { ...publicPart, renewable: Boolean(account?.renewable && brand.renewalEnabled) };
  }

  private logLookup(brandId: string, found: boolean, source: string) {
    void this.prisma.lookupEvent.create({ data: { brandId, found, source } }).catch(() => undefined);
  }

  /**
   * Find the account behind a subscription link: search the brand's panels by
   * the subId in the URL (or the PasarGuard token), then fall back to the
   * subscription endpoint's own metadata.
   */
  async lookup(brand: Brand & { panels: { id: string }[] }, url: string): Promise<LookupResult> {
    const parsed = this.parseUrl(url);
    const subId = extractSubId(url);
    const panelIds = brand.panels.map((p) => p.id);
    const panels = await this.prisma.panelConnection.findMany({
      where: panelIds.length ? { id: { in: panelIds } } : { orgId: brand.orgId },
      orderBy: { createdAt: 'asc' },
    });
    // Panels on the same host as the link are the likeliest match.
    panels.sort((a, b) => sameHost(b.baseUrl, parsed) - sameHost(a.baseUrl, parsed));

    for (const panel of panels) {
      const found = await this.gateway.find(panel, url, subId);
      if (found) {
        return {
          subId: found.clientRef,
          redactedUrl: redactUrl(url),
          snapshot: found.snapshot,
          online: found.online,
          lastOnlineAt: found.lastOnlineAt,
          renewable: found.renewable,
          account: found,
        };
      }
    }

    // Only now do we fetch the link itself, so only now does it need the DNS/SSRF check.
    await this.assertFetchable(parsed);
    const fallback = await this.fromSubscriptionEndpoint(url, subId);
    if (!fallback) {
      throw new NotFoundException(
        'We could not find this subscription. Check the link, or ask support to confirm it is still active.',
      );
    }
    return {
      subId: subId ?? fallback.snapshot.subscriptionId,
      redactedUrl: redactUrl(url),
      snapshot: fallback.snapshot,
      online: fallback.online,
      lastOnlineAt: fallback.lastOnlineAt,
      renewable: false,
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
      return snapshot ? { snapshot, online: null, lastOnlineAt: null } : null;
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
        throw new NotFoundException(
          'We could not find this subscription. Check the link, or ask support to confirm it is still active.',
        );
      }
      throw err;
    }
  }
}

function sameHost(base: string, link: URL): number {
  try {
    return new URL(base).hostname === link.hostname ? 1 : 0;
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
