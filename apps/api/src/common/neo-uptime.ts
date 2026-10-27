import { assertPublicHttpUrl, resolveAndAssertPublic, SsrfError } from './ssrf/ssrf.guard';

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
        message: text(o.content ?? o.message ?? o.description ?? o.body, 600) || null,
        status: text(o.status ?? o.style ?? o.state, 32) || null,
        at: when(o.start ?? o.startedAt ?? o.createdAt ?? o.startsAt ?? o.updatedAt),
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
 * Read a NeoUptime status page the way its embed.js does (GET /api/v1/status/{slug},
 * Bearer key), from the server. Errors say what went wrong in words an admin can act on.
 */
export async function fetchNeoUptime(baseUrl: string, slug: string, key: string | null): Promise<NetworkStatus> {
  let url: URL;
  try {
    url = assertPublicHttpUrl(`${baseUrl.replace(/\/+$/, '')}/api/v1/status/${encodeURIComponent(slug)}`);
    await resolveAndAssertPublic(url);
  } catch (err) {
    if (err instanceof SsrfError) throw new Error(`آدرس NeoUptime قابل استفاده نیست (${err.message})`);
    throw err;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    throw new Error(`سرور به ${url.host} دسترسی ندارد${cause ? ` (${cause})` : ''}`);
  }
  if (!res.ok) {
    const said = await res
      .json()
      .then((j: { error?: string; message?: string }) => j?.error || j?.message || '')
      .catch(() => '');
    const why =
      res.status === 401
        ? 'کلید پذیرفته نشد'
        : res.status === 403
          ? 'این کلید برای این صفحه یا این مبدأ مجاز نیست'
          : res.status === 404
            ? 'صفحهٔ وضعیت با این slug پیدا نشد'
            : `NeoUptime HTTP ${res.status}`;
    throw new Error(`${why}${said ? ` — ${String(said).slice(0, 160)}` : ''}`);
  }
  return cleanNetworkStatus(await res.json());
}
