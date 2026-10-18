import { Injectable, Logger } from '@nestjs/common';
import {
  SubscriptionUserInfo,
  XuiClient,
  XuiClientRenewalPreview,
  XuiClientTraffic,
  XuiMsg,
  XuiSubInfoViewModel,
} from './types';
import {
  deriveStatus,
  expiryFromMs,
  normalizeFromClientTraffic,
  parseSubscriptionUserInfo,
  quotaFromTotalBytes,
  remaining,
} from './normalize';
import { NormalizedSubscription } from './types';
import { RenewalTerms, nextExpiryMs, nextQuotaBytes } from '../../panels/renewal-terms';

const GB = 1024 * 1024 * 1024;

export interface XuiConnectionConfig {
  /** Panel origin including webBasePath, e.g. https://panel.example.com/R8JJdluxTpdzcdkywn */
  baseUrl: string;
  /** Bearer API token (Settings → Security → API Token) preferred. */
  apiToken?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

/**
 * Server-side adapter for the documented 3X-UI Panel API (docs/api310.json).
 * Frontend must never call the panel admin API directly.
 */
@Injectable()
export class XuiClientService {
  private readonly logger = new Logger(XuiClientService.name);

  async testConnection(cfg: XuiConnectionConfig): Promise<{
    ok: boolean;
    message: string;
  }> {
    try {
      const session = await this.authenticate(cfg);
      const res = await this.request<unknown>(
        cfg,
        'GET',
        '/panel/api/server/status',
        { session },
      );
      if (!res.success) {
        return { ok: false, message: res.msg || 'Panel returned success=false' };
      }
      return { ok: true, message: 'Connected' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      this.logger.warn(`Panel connectivity test failed: ${message}`);
      return { ok: false, message };
    }
  }

  async getClientByEmail(
    cfg: XuiConnectionConfig,
    email: string,
  ): Promise<XuiClient | null> {
    const session = await this.authenticate(cfg);
    const res = await this.request<XuiClient | XuiClient[]>(
      cfg,
      'GET',
      `/panel/api/clients/get/${encodeURIComponent(email)}`,
      { session },
    );
    if (!res.success) throw new Error(res.msg || 'Failed to fetch client');
    if (!res.obj) return null;
    return Array.isArray(res.obj) ? res.obj[0] ?? null : res.obj;
  }

  async getClientTraffic(
    cfg: XuiConnectionConfig,
    email: string,
  ): Promise<XuiClientTraffic | null> {
    const session = await this.authenticate(cfg);
    const res = await this.request<XuiClientTraffic>(
      cfg,
      'GET',
      `/panel/api/clients/traffic/${encodeURIComponent(email)}`,
      { session },
    );
    if (!res.success) throw new Error(res.msg || 'Failed to fetch traffic');
    return res.obj ?? null;
  }

  async listClients(cfg: XuiConnectionConfig): Promise<unknown[]> {
    const session = await this.authenticate(cfg);
    const res = await this.request<unknown[]>(
      cfg,
      'GET',
      '/panel/api/clients/list',
      { session },
    );
    if (!res.success) throw new Error(res.msg || 'Failed to list clients');
    return Array.isArray(res.obj) ? res.obj : [];
  }

  async getSubLinks(
    cfg: XuiConnectionConfig,
    subId: string,
  ): Promise<string[]> {
    const session = await this.authenticate(cfg);
    const res = await this.request<string[]>(
      cfg,
      'GET',
      `/panel/api/clients/subLinks/${encodeURIComponent(subId)}`,
      { session },
    );
    if (!res.success) throw new Error(res.msg || 'Failed to fetch sub links');
    return Array.isArray(res.obj) ? res.obj : [];
  }

  async renewalPreview(
    cfg: XuiConnectionConfig,
    body: {
      expiryTime: number;
      reset: number;
      resetDay: number;
      resetWeekday: number;
      resetMax: number;
      resetCount: number;
    },
  ): Promise<XuiClientRenewalPreview> {
    const session = await this.authenticate(cfg);
    const res = await this.request<XuiClientRenewalPreview>(
      cfg,
      'POST',
      '/panel/api/clients/renewalPreview',
      { session, body },
    );
    if (!res.success) throw new Error(res.msg || 'renewalPreview failed');
    return res.obj;
  }

  /**
   * Public subscription endpoint:
   * GET /{subPath}{subid}?format=info
   * Also reads subscription-userinfo-style headers from HEAD/GET.
   */
  async fetchSubscriptionInfo(
    subscriptionUrl: string,
    opts?: { timeoutMs?: number; fetchImpl?: typeof fetch },
  ): Promise<{
    info: XuiSubInfoViewModel | null;
    userInfo: SubscriptionUserInfo | null;
    reachable: boolean;
  }> {
    const fetchFn = opts?.fetchImpl ?? fetch;
    const timeoutMs = opts?.timeoutMs ?? 12_000;
    const url = new URL(subscriptionUrl);
    url.searchParams.set('format', 'info');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'NeoConfig/1.0',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        throw new Error('Redirects are not followed for subscription fetches');
      }

      const userInfo =
        parseSubscriptionUserInfo(res.headers.get('subscription-userinfo')) ||
        parseSubscriptionUserInfo(res.headers.get('Subscription-Userinfo'));

      let info: XuiSubInfoViewModel | null = null;
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const text = await res.text();
        if (text.length > 512_000) {
          throw new Error('Subscription response too large');
        }
        try {
          const parsed = JSON.parse(text) as unknown;
          if (parsed && typeof parsed === 'object') {
            const msg = parsed as XuiMsg<XuiSubInfoViewModel>;
            if ('obj' in msg && msg.obj && typeof msg.obj === 'object') {
              info = msg.obj;
            } else {
              info = parsed as XuiSubInfoViewModel;
            }
          }
        } catch {
          info = null;
        }
      }

      // Fallback: HEAD-equivalent metadata via original URL without format=info
      if (!userInfo) {
        const headInfo = await this.headUserInfo(subscriptionUrl, fetchFn, timeoutMs);
        return {
          info,
          userInfo: headInfo,
          reachable: res.ok || res.status === 404,
        };
      }

      return { info, userInfo, reachable: res.ok };
    } finally {
      clearTimeout(timer);
    }
  }

  private async headUserInfo(
    subscriptionUrl: string,
    fetchFn: typeof fetch,
    timeoutMs: number,
  ): Promise<SubscriptionUserInfo | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(subscriptionUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'NeoConfig/1.0' },
      });
      if (res.status >= 300 && res.status < 400) return null;
      return (
        parseSubscriptionUserInfo(res.headers.get('subscription-userinfo')) ||
        parseSubscriptionUserInfo(res.headers.get('Subscription-Userinfo'))
      );
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Find every client sharing a subId (3x-ui lets one subscription span several
   * inbounds) and aggregate them the way the panel's own sub page does.
   * Uses the classic `inbounds/list` API (Sanaei 2.x) and falls back to the
   * 3.x `clients/list` API.
   */
  async findBySubId(
    cfg: XuiConnectionConfig,
    subId: string,
  ): Promise<XuiAccountMatch | null> {
    const source = await this.clientSource(cfg);
    const matches = source.matches.filter((m) => m.client.subId === subId || m.client.email === subId);
    if (!matches.length) return null;
    const online = await this.onlineEmails(cfg, source.kind).catch(() => null);
    if (source.kind === 'v3') {
      // clients/list carries no lastOnline; one traffic call fills it in.
      const traffic = await this.getClientTraffic(cfg, matches[0].client.email).catch(() => null);
      if (traffic?.lastOnline && matches[0].stat) matches[0].stat.lastOnline = Number(traffic.lastOnline);
    }
    return aggregateMatches(subId, matches, online);
  }

  /** Apply renewal terms to every client sharing the subId (see RenewalTerms). */
  async renewBySubId(
    cfg: XuiConnectionConfig,
    subId: string,
    plan: RenewalTerms,
  ): Promise<{ ok: boolean; message: string }> {
    const source = await this.clientSource(cfg, true);
    const matches = source.matches.filter((m) => m.client.subId === subId || m.client.email === subId);
    if (!matches.length) return { ok: false, message: 'Client not found on panel' };

    const session = await this.authenticate(cfg);
    const now = Date.now();
    for (const { inbound, client } of matches) {
      const current = Number(client.expiryTime) || 0;
      const changes: Partial<XuiInboundClient> = {
        enable: true,
        // A negative expiry is "starts on first use"; a renewal makes it concrete.
        expiryTime: nextExpiryMs(current < 0 ? 0 : current, plan.days, now),
        totalGB: nextQuotaBytes(Number(client.totalGB) || 0, plan),
      };
      if (plan.users > 0) changes.limitIp = plan.users;

      const res =
        source.kind === 'v3'
          ? await this.updateClientV3(cfg, session, client, changes)
          : await this.request<unknown>(
              cfg,
              'POST',
              `/panel/api/inbounds/updateClient/${encodeURIComponent(clientKey(String(inbound.protocol ?? ''), client))}`,
              { session, body: { id: inbound.id, settings: JSON.stringify({ clients: [{ ...client, ...changes }] }) } },
            );
      if (!res.success) {
        return { ok: false, message: res.msg || `Update failed for ${client.email}` };
      }
      if (plan.mode === 'reset') {
        const reset = await this.request<unknown>(
          cfg,
          'POST',
          source.kind === 'v3'
            ? `/panel/api/clients/resetTraffic/${encodeURIComponent(client.email)}`
            : `/panel/api/inbounds/${inbound.id}/resetClientTraffic/${encodeURIComponent(client.email)}`,
          { session },
        );
        if (!reset.success) {
          return { ok: false, message: reset.msg || `Traffic reset failed for ${client.email}` };
        }
      }
    }
    this.cache.delete(cacheKey(cfg));
    this.v3cache.delete(cacheKey(cfg));
    return { ok: true, message: `Renewed ${matches.length} client(s)` };
  }

  /**
   * 3x-ui 3.x replaces the whole client row on update, so send the full record
   * (from clients/get when available, else the clients/list row) with our changes.
   */
  private async updateClientV3(
    cfg: XuiConnectionConfig,
    session: { cookie?: string; bearer?: string },
    client: XuiInboundClient,
    changes: Partial<XuiInboundClient>,
  ) {
    const got = await this.request<Record<string, unknown>>(
      cfg,
      'GET',
      `/panel/api/clients/get/${encodeURIComponent(client.email)}`,
      { session },
    ).catch(() => null);
    const obj = got?.success && got.obj && typeof got.obj === 'object' ? got.obj : null;
    const full =
      obj && 'client' in obj && obj.client && typeof obj.client === 'object' ? (obj.client as Record<string, unknown>) : obj;
    const base: Record<string, unknown> = { ...client, ...(full && 'email' in full ? full : {}) };
    delete base.traffic;
    return this.request<unknown>(cfg, 'POST', `/panel/api/clients/update/${encodeURIComponent(client.email)}`, {
      session,
      body: { ...base, ...changes },
    });
  }

  /** Lightweight stats for the admin connection card. */
  async stats(cfg: XuiConnectionConfig): Promise<{ clients: number; online: number | null }> {
    const source = await this.clientSource(cfg, true);
    const online = await this.onlineEmails(cfg, source.kind).catch(() => null);
    // A 3.x client attached to several inbounds is one row; classic ones repeat per inbound.
    const unique = new Set(source.matches.map((m) => m.client.subId || m.client.email));
    return { clients: unique.size, online: online?.size ?? null };
  }

  /**
   * Where this panel keeps its clients. Classic 3x-ui (2.x) embeds them in each
   * inbound's settings; 3.x keeps them in their own table (clients/list) and the
   * inbounds come back without clients.
   */
  private async clientSource(
    cfg: XuiConnectionConfig,
    fresh = false,
  ): Promise<{ kind: 'classic' | 'v3'; matches: ClientMatch[] }> {
    const inbounds = await this.listInboundsSafe(cfg, fresh);
    const classic = inbounds ? collectClients(inbounds) : [];
    if (classic.length) return { kind: 'classic', matches: classic };
    const v3 = await this.listClientsV3(cfg, fresh);
    if (v3) return { kind: 'v3', matches: v3 };
    return { kind: 'classic', matches: classic };
  }

  private v3cache = new Map<string, { at: number; matches: ClientMatch[] }>();

  private async listClientsV3(cfg: XuiConnectionConfig, fresh = false): Promise<ClientMatch[] | null> {
    const key = cacheKey(cfg);
    const hit = this.v3cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.matches;
    const session = await this.authenticate(cfg);
    let res: XuiMsg<Array<Record<string, unknown>>>;
    try {
      res = await this.request<Array<Record<string, unknown>>>(cfg, 'GET', '/panel/api/clients/list', { session });
    } catch (err) {
      if (err instanceof PanelHttpError && err.status === 404) return null;
      throw err;
    }
    if (!res.success || !Array.isArray(res.obj)) return null;
    const matches = res.obj.filter((c) => c && c.email).map(v3Match);
    this.v3cache.set(key, { at: Date.now(), matches });
    return matches;
  }

  private cache = new Map<string, { at: number; inbounds: XuiInbound[] }>();
  private sessions = new Map<string, { at: number; cookie: string }>();

  private async listInboundsSafe(
    cfg: XuiConnectionConfig,
    fresh = false,
  ): Promise<XuiInbound[] | null> {
    const key = cacheKey(cfg);
    const hit = this.cache.get(key);
    if (!fresh && hit && Date.now() - hit.at < 20_000) return hit.inbounds;
    const session = await this.authenticate(cfg);
    let res: XuiMsg<XuiInbound[]>;
    try {
      res = await this.request<XuiInbound[]>(cfg, 'GET', '/panel/api/inbounds/list', { session });
    } catch (err) {
      if (err instanceof PanelHttpError && err.status === 404) return null;
      throw err;
    }
    if (!res.success) throw new Error(res.msg || 'Failed to list inbounds');
    const inbounds = Array.isArray(res.obj) ? res.obj : [];
    this.cache.set(key, { at: Date.now(), inbounds });
    return inbounds;
  }

  private async onlineEmails(cfg: XuiConnectionConfig, kind: 'classic' | 'v3' = 'classic'): Promise<Set<string>> {
    const session = await this.authenticate(cfg);
    const paths =
      kind === 'v3' ? ['/panel/api/clients/onlines', '/panel/api/inbounds/onlines'] : ['/panel/api/inbounds/onlines'];
    for (const path of paths) {
      const res = await this.request<string[] | null>(cfg, 'POST', path, { session }).catch(() => null);
      if (res?.success) return new Set(Array.isArray(res.obj) ? res.obj : []);
    }
    throw new Error('onlines unavailable');
  }

  private async authenticate(cfg: XuiConnectionConfig): Promise<{
    cookie?: string;
    bearer?: string;
  }> {
    if (cfg.apiToken) {
      return { bearer: cfg.apiToken };
    }
    if (!cfg.username || !cfg.password) {
      throw new Error('Panel credentials missing (need apiToken or username/password)');
    }
    const key = cacheKey(cfg);
    const cached = this.sessions.get(key);
    if (cached && Date.now() - cached.at < 10 * 60_000) return { cookie: cached.cookie };

    const url = this.join(cfg.baseUrl, '/login');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ username: cfg.username, password: cfg.password }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });

    const body = (await res.json().catch(() => null)) as XuiMsg | null;
    if (!body?.success) {
      throw new Error(body?.msg || `Panel login failed (HTTP ${res.status})`);
    }

    // Cookie name is `3x-ui` on current releases and `session` on older ones.
    const cookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie') || ''];
    const pair = cookies
      .map((c) => c.split(';')[0]?.trim())
      .find((c) => c && /^(3x-ui|session)=/.test(c));
    if (!pair) {
      throw new Error('Panel login succeeded but session cookie was not returned');
    }
    this.sessions.set(key, { at: Date.now(), cookie: pair });
    return { cookie: pair };
  }

  private async request<T>(
    cfg: XuiConnectionConfig,
    method: string,
    path: string,
    opts: { session: { cookie?: string; bearer?: string }; body?: unknown },
  ): Promise<XuiMsg<T>> {
    const url = this.join(cfg.baseUrl, path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.session.bearer) {
      headers.Authorization = `Bearer ${opts.session.bearer}`;
    }
    if (opts.session.cookie) {
      headers.Cookie = opts.session.cookie;
    }
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      cfg.timeoutMs ?? 15_000,
    );
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        // Expired cookie sessions redirect to the login page.
        this.sessions.delete(cacheKey(cfg));
        throw new PanelHttpError('Unexpected redirect from panel API (check credentials/base path)', res.status);
      }
      if (res.status === 401 || res.status === 403) {
        this.sessions.delete(cacheKey(cfg));
        throw new PanelHttpError('Panel rejected the credentials', res.status);
      }
      const text = await res.text();
      try {
        return JSON.parse(text) as XuiMsg<T>;
      } catch {
        throw new PanelHttpError(`Panel returned a non-JSON response (HTTP ${res.status})`, res.status);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private join(baseUrl: string, path: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }
}

export class PanelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface XuiAccountMatch {
  subId: string;
  displayName: string;
  snapshot: NormalizedSubscription;
  online: boolean | null;
  lastOnlineAt: string | null;
  renewable: boolean;
}

interface XuiInbound {
  id: number;
  protocol?: string;
  remark?: string;
  settings?: string;
  clientStats?: Array<{
    email: string;
    up: number;
    down: number;
    total: number;
    expiryTime: number;
    enable: boolean;
    lastOnline?: number;
  }> | null;
}

interface XuiInboundClient {
  id?: string;
  password?: string;
  email: string;
  enable?: boolean;
  expiryTime?: number;
  /** Bytes on classic 3x-ui despite the name. */
  totalGB?: number;
  subId?: string;
  comment?: string;
  [key: string]: unknown;
}

type ClientMatch = {
  inbound: XuiInbound;
  client: XuiInboundClient;
  stat: NonNullable<XuiInbound['clientStats']>[number] | null;
};

function cacheKey(cfg: XuiConnectionConfig) {
  return `${cfg.baseUrl}|${cfg.username ?? ''}|${cfg.apiToken ? 'token' : ''}`;
}

function clientKey(protocol: string, client: XuiInboundClient): string {
  if (protocol === 'trojan') return String(client.password ?? client.email);
  if (protocol === 'shadowsocks') return client.email;
  return String(client.id ?? client.password ?? client.email);
}

export function collectClients(inbounds: XuiInbound[]): ClientMatch[] {
  const out: ClientMatch[] = [];
  for (const inbound of inbounds) {
    let clients: XuiInboundClient[] = [];
    try {
      // A JSON string on 2.x; some builds already return it parsed.
      const raw = inbound.settings as unknown;
      const settings = (typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})) as { clients?: XuiInboundClient[] };
      clients = Array.isArray(settings.clients) ? settings.clients : [];
    } catch {
      clients = [];
    }
    for (const client of clients) {
      if (!client?.email) continue;
      const stat = inbound.clientStats?.find((s) => s.email === client.email) ?? null;
      out.push({ inbound, client, stat });
    }
  }
  return out;
}

/** A 3.x clients/list row in the same shape as an inbound client + its traffic stat. */
function v3Match(c: Record<string, unknown>): ClientMatch {
  const traffic = (c.traffic ?? {}) as { up?: number; down?: number; enable?: boolean; lastOnline?: number };
  const client = { ...c, email: String(c.email), subId: c.subId ? String(c.subId) : undefined } as XuiInboundClient;
  return {
    inbound: { id: 0 },
    client,
    stat: {
      email: client.email,
      up: Number(traffic.up) || 0,
      down: Number(traffic.down) || 0,
      total: Number(c.totalGB) || 0,
      expiryTime: Number(c.expiryTime) || 0,
      enable: c.enable !== false && traffic.enable !== false,
      lastOnline: Number(traffic.lastOnline) || 0,
    },
  };
}

/** Mirrors the 3x-ui sub page: traffic is summed, any unlimited quota wins, earliest expiry wins. */
export function aggregateMatches(
  subId: string,
  matches: ClientMatch[],
  online: Set<string> | null,
): XuiAccountMatch {
  let up = 0;
  let down = 0;
  let total = 0;
  let unlimitedQuota = false;
  let expiry: number | null = null;
  let anyEnabled = false;
  let lastOnline = 0;

  for (const { client, stat } of matches) {
    up += Number(stat?.up) || 0;
    down += Number(stat?.down) || 0;
    const quota = Number(stat?.total ?? client.totalGB) || 0;
    if (quota <= 0) unlimitedQuota = true;
    else total += quota;
    const exp = Number(stat?.expiryTime ?? client.expiryTime) || 0;
    if (exp > 0) expiry = expiry === null ? exp : Math.min(expiry, exp);
    if ((stat?.enable ?? client.enable) !== false) anyEnabled = true;
    lastOnline = Math.max(lastOnline, Number(stat?.lastOnline) || 0);
  }

  const used = up + down;
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(unlimitedQuota ? 0 : total);
  const rem = remaining(quotaKind, quotaBytes, used);
  const negativeStart = matches.some((m) => Number(m.client.expiryTime) < 0);
  const exp = expiry !== null ? expiryFromMs(expiry) : expiryFromMs(negativeStart ? -1 : 0);
  let status = deriveStatus({
    enabled: anyEnabled,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: rem,
    quotaKind,
  });
  if (negativeStart && status === 'active') status = 'on_hold';

  const first = matches[0].client;
  const name = String(first.comment || first.email);
  return {
    subId,
    displayName: name,
    snapshot: {
      subscriptionId: subId,
      displayName: name,
      status,
      uploadBytes: up,
      downloadBytes: down,
      totalUsedBytes: used,
      quotaBytes,
      remainingBytes: rem,
      quotaKind,
      expiryAt: exp.expiryAt,
      expiryKind: exp.expiryKind,
      enabled: anyEnabled,
      dataSource: '3x-ui:inbounds/list',
      syncState: 'ok',
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
    },
    online: online ? matches.some((m) => online.has(m.client.email)) : null,
    lastOnlineAt: lastOnline > 0 ? new Date(lastOnline).toISOString() : null,
    renewable: true,
  };
}

// Re-export for consumers that import user-info parsing from the client module path
export { parseSubscriptionUserInfo };
export type { SubscriptionUserInfo };
