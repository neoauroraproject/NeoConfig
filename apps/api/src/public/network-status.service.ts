import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandsService } from '../brands/brands.service';
import { decryptSecret } from '../common/crypto/secret.crypto';
import { assertPublicHttpUrl, resolveAndAssertPublic } from '../common/ssrf/ssrf.guard';

const MONITOR_STATES = new Set(['up', 'down', 'pending', 'maintenance', 'paused', 'unknown']);

export interface NetworkMonitor {
  name: string;
  country: string | null;
  status: string;
  latencyMs: number | null;
  uptime24h: number | null;
  uptime30d: number | null;
  /** Oldest first: u(p), d(own), p(ending), m(aintenance)… */
  history: string[];
}

export interface NetworkNotice {
  title: string;
  message: string | null;
  status: string | null;
  at: number | null;
}

export interface NetworkStatus {
  enabled: true;
  overall: string;
  updatedAt: number | null;
  groups: Array<{ name: string; monitors: NetworkMonitor[] }>;
  incidents: NetworkNotice[];
  maintenance: NetworkNotice[];
  /** The last good reading, shown while NeoUptime can't be reached. */
  stale?: boolean;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const when = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && Date.parse(v) ? Date.parse(v) : null);

/** Only what the app shows: names, states and numbers (NeoUptime's own payload never passes through). */
export function cleanNetworkStatus(raw: unknown): NetworkStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const notices = (v: unknown): NetworkNotice[] =>
    (Array.isArray(v) ? v : []).slice(0, 10).map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return {
        title: text(o.title ?? o.name, 120) || '—',
        message: text(o.message ?? o.description ?? o.body, 600) || null,
        status: text(o.status ?? o.state, 32) || null,
        at: when(o.startedAt ?? o.createdAt ?? o.startsAt ?? o.updatedAt),
      };
    });
  return {
    enabled: true,
    overall: text(r.overall, 32) || 'unknown',
    updatedAt: num(r.updatedAt),
    groups: (Array.isArray(r.groups) ? r.groups : []).slice(0, 20).map((g) => {
      const o = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
      return {
        name: text(o.name, 80),
        monitors: (Array.isArray(o.monitors) ? o.monitors : []).slice(0, 60).map((m) => {
          const x = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
          const status = text(x.status, 16).toLowerCase();
          return {
            name: text(x.name, 80),
            country: /^[a-z]{2}$/i.test(text(x.country, 8)) ? text(x.country, 8).toLowerCase() : null,
            status: MONITOR_STATES.has(status) ? status : 'unknown',
            latencyMs: num(x.latencyMs),
            uptime24h: num(x.uptime24h),
            uptime30d: num(x.uptime30d),
            history: (Array.isArray(x.history) ? x.history : []).slice(-60).map((h) => text(h, 1).toLowerCase() || 'u'),
          };
        }),
      };
    }),
    incidents: notices(r.incidents),
    maintenance: notices(r.maintenance),
  };
}

/**
 * The brand's NeoUptime status page, fetched by the server (the API key never
 * reaches the browser) and cached for a minute.
 */
@Injectable()
export class NetworkStatusService {
  private readonly logger = new Logger(NetworkStatusService.name);
  private cache = new Map<string, { at: number; data: NetworkStatus }>();

  constructor(
    private readonly brands: BrandsService,
    private readonly config: ConfigService,
  ) {}

  async forTenant(tenant?: string): Promise<NetworkStatus | { enabled: false }> {
    const brand = await this.brands.resolve(tenant);
    if (!brand) throw new NotFoundException('No storefront is configured yet');
    if (!brand.uptimeUrl || !brand.uptimeSlug) return { enabled: false };
    const hit = this.cache.get(brand.id);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;
    try {
      const url = assertPublicHttpUrl(`${brand.uptimeUrl}/api/v1/status/${encodeURIComponent(brand.uptimeSlug)}`);
      await resolveAndAssertPublic(url);
      const key = brand.uptimeKeyEnc ? decryptSecret(brand.uptimeKeyEnc, this.config.getOrThrow<string>('ENCRYPTION_KEY')) : null;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`NeoUptime HTTP ${res.status}`);
      const data = cleanNetworkStatus(await res.json());
      this.cache.set(brand.id, { at: Date.now(), data });
      return data;
    } catch (err) {
      this.logger.warn(`Network status for ${brand.slug} failed: ${err instanceof Error ? err.message : err}`);
      if (hit) return { ...hit.data, stale: true };
      return { enabled: true, overall: 'unknown', updatedAt: null, groups: [], incidents: [], maintenance: [], stale: true };
    }
  }
}
