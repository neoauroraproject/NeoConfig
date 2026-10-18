import { Injectable } from '@nestjs/common';
import {
  deriveStatus,
  expiryFromMs,
  quotaFromTotalBytes,
  remaining,
} from '../xui/normalize';
import { NormalizedStatus, NormalizedSubscription } from '../xui/types';
import { RenewalTerms, nextExpiryMs, nextQuotaBytes } from '../../panels/renewal-terms';

const GB = 1024 * 1024 * 1024;

export interface PasarGuardConfig {
  /** Panel origin, e.g. https://panel.example.com:8000 */
  baseUrl: string;
  /** Optional pre-issued admin bearer token. */
  apiToken?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
}

/** Subset of PasarGuard's UserResponse / SubscriptionUserResponse. */
export interface PasarGuardUser {
  id?: number;
  username: string;
  status: string;
  used_traffic?: number;
  lifetime_used_traffic?: number;
  data_limit?: number | null;
  /** ISO datetime, unix seconds, 0 or null (= never). */
  expire?: string | number | null;
  on_hold_expire_duration?: number | null;
  online_at?: string | null;
  note?: string | null;
  hwid_limit?: number | null;
}

export interface PasarGuardMatch {
  username: string;
  snapshot: NormalizedSubscription;
  online: boolean | null;
  lastOnlineAt: string | null;
  deviceLimit?: number | null;
}

/**
 * Server-side adapter for PasarGuard (Marzban lineage):
 *  - POST /api/admin/token            (form: username, password)
 *  - GET  /api/user/{username}        | GET /api/user/by-id/{id}
 *  - PUT  /api/user/{username}        (expire, data_limit, status)
 *  - POST /api/user/{username}/reset
 *  - GET  {subscription}/info         (public, no admin token)
 */
@Injectable()
export class PasarGuardClientService {
  private tokens = new Map<string, { at: number; token: string }>();

  async testConnection(cfg: PasarGuardConfig): Promise<{
    ok: boolean;
    message: string;
    stats?: { clients: number | null; online: number | null };
  }> {
    try {
      const sys = await this.request<Record<string, unknown>>(cfg, 'GET', '/api/system');
      const clients = num(sys.total_user);
      const online = num(sys.online_users);
      const version = typeof sys.version === 'string' ? ` · v${sys.version}` : '';
      return { ok: true, message: `Connected${version}`, stats: { clients, online } };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  /** Resolve the account behind a subscription URL using the admin API. */
  async findBySubscriptionUrl(
    cfg: PasarGuardConfig,
    subUrl: string,
  ): Promise<PasarGuardMatch | null> {
    const ref = decodeSubscriptionRef(subUrl);
    if (!ref) return null;
    const path =
      ref.userId !== undefined
        ? `/api/user/by-id/${ref.userId}`
        : `/api/user/${encodeURIComponent(ref.username!)}`;
    try {
      const user = await this.request<PasarGuardUser>(cfg, 'GET', path);
      return toMatch(user);
    } catch (err) {
      if (err instanceof PasarGuardHttpError && err.status === 404) return null;
      throw err;
    }
  }

  /** Public `/info` endpoint — works without admin credentials. */
  async fetchPublicInfo(subUrl: string, timeoutMs = 12_000): Promise<PasarGuardMatch | null> {
    const base = subscriptionBase(subUrl);
    if (!base) return null;
    const res = await fetch(`${base}/info`, {
      headers: { Accept: 'application/json', 'User-Agent': 'NeoConfig/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    const user = (await res.json().catch(() => null)) as PasarGuardUser | null;
    if (!user || typeof user.username !== 'string' || typeof user.status !== 'string') return null;
    return toMatch(user);
  }

  async renew(
    cfg: PasarGuardConfig,
    username: string,
    plan: RenewalTerms,
  ): Promise<{ ok: boolean; message: string }> {
    const path = `/api/user/${encodeURIComponent(username)}`;
    const user = await this.request<PasarGuardUser>(cfg, 'GET', path);
    const body: Record<string, unknown> = {
      status: 'active',
      data_limit: nextQuotaBytes(Number(user.data_limit) || 0, plan, Number(user.used_traffic) || 0),
    };
    if (plan.days > 0) {
      body.expire = new Date(nextExpiryMs(expireToMs(user.expire) ?? 0, plan.days)).toISOString();
    }
    if (plan.users > 0) body.hwid_limit = plan.users;
    await this.request(cfg, 'PUT', path, body);
    if (plan.mode === 'reset') await this.request(cfg, 'POST', `${path}/reset`);
    return { ok: true, message: 'Renewed on PasarGuard' };
  }

  private async token(cfg: PasarGuardConfig): Promise<string> {
    if (cfg.apiToken) return cfg.apiToken;
    if (!cfg.username || !cfg.password) {
      throw new Error('Panel credentials missing (need admin username/password)');
    }
    const key = `${cfg.baseUrl}|${cfg.username}`;
    const cached = this.tokens.get(key);
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.token;

    const res = await fetch(join(cfg.baseUrl, '/api/admin/token'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: cfg.username,
        password: cfg.password,
      }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; detail?: string } | null;
    if (!res.ok || !body?.access_token) {
      throw new Error(body?.detail || `PasarGuard login failed (HTTP ${res.status})`);
    }
    this.tokens.set(key, { at: Date.now(), token: body.access_token });
    return body.access_token;
  }

  private async request<T>(
    cfg: PasarGuardConfig,
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    const token = await this.token(cfg);
    const res = await fetch(join(cfg.baseUrl, path), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
    if (res.status === 401 && !retried && !cfg.apiToken) {
      this.tokens.delete(`${cfg.baseUrl}|${cfg.username}`);
      return this.request<T>(cfg, method, path, body, true);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new PasarGuardHttpError(`PasarGuard returned a non-JSON response (HTTP ${res.status})`, res.status);
    }
    if (!res.ok) {
      const detail = (json as { detail?: unknown })?.detail;
      throw new PasarGuardHttpError(
        typeof detail === 'string' ? detail : `PasarGuard request failed (HTTP ${res.status})`,
        res.status,
      );
    }
    return json as T;
  }
}

export class PasarGuardHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const CLIENT_TYPES = new Set([
  'info', 'raw', 'apps', 'usage', 'links', 'links_base64', 'xray', 'sing_box',
  'clash', 'clash_meta', 'outline', 'v2ray', 'v2ray_json', 'wireguard',
]);

/** `https://x/sub/<token>/v2ray` → `https://x/sub/<token>` */
export function subscriptionBase(subUrl: string): string | null {
  try {
    const u = new URL(subUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    while (parts.length && CLIENT_TYPES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    if (!parts.length) return null;
    return `${u.origin}/${parts.join('/')}`;
  } catch {
    return null;
  }
}

/**
 * Subscription tokens carry the account reference:
 *  - JWT (`eyJ…`) with `sub` = username
 *  - `<b64("v3,<id>,<ts>")>.<hmac>` (current)
 *  - `<b64("username,<ts>")><10-char sig>` (legacy Marzban)
 */
export function decodeSubscriptionRef(
  subUrl: string,
): { userId?: number; username?: string } | null {
  const base = subscriptionBase(subUrl);
  if (!base) return null;
  const token = base.split('/').pop() || '';
  if (token.length < 15) return null;

  if (token.startsWith('eyJ')) {
    const payload = b64json(token.split('.')[1]);
    return typeof payload?.sub === 'string' ? { username: payload.sub } : null;
  }
  if (token.includes('.')) {
    const data = b64text(token.slice(0, token.lastIndexOf('.')));
    return data ? parsePayload(data) : null;
  }
  const data = b64text(token.slice(0, -10));
  return data ? parsePayload(data) : null;
}

function parsePayload(data: string): { userId?: number; username?: string } | null {
  const parts = data.split(',');
  if ((parts[0] === 'v2' || parts[0] === 'v3') && parts[1] && /^\d+$/.test(parts[1])) {
    return { userId: Number(parts[1]) };
  }
  if (parts.length === 2 && parts[0] && /^\d+$/.test(parts[1])) {
    return { username: parts[0] };
  }
  return null;
}

function b64text(s: string | undefined): string | null {
  if (!s) return null;
  try {
    const text = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^[\x20-\x7e]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

function b64json(s: string | undefined): Record<string, unknown> | null {
  const text = b64text(s);
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function expireToMs(expire: PasarGuardUser['expire']): number | null {
  if (expire === null || expire === undefined || expire === 0 || expire === '') return null;
  if (typeof expire === 'number') return expire < 1e12 ? expire * 1000 : expire;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(expire);
  const ms = Date.parse(hasZone ? expire : `${expire}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizePasarGuardUser(user: PasarGuardUser): NormalizedSubscription {
  const used = num(user.used_traffic);
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(user.data_limit ?? 0);
  const rem = remaining(quotaKind, quotaBytes, used);
  const expMs = expireToMs(user.expire);
  const exp = expiryFromMs(expMs ?? 0);
  const derived = deriveStatus({
    enabled: user.status !== 'disabled',
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: rem,
    quotaKind,
  });
  const map: Record<string, NormalizedStatus> = {
    disabled: 'disabled',
    expired: 'expired',
    limited: 'limited',
    on_hold: 'on_hold',
  };
  const status = map[user.status] ?? derived;

  return {
    subscriptionId: user.username,
    displayName: user.username,
    status,
    uploadBytes: null,
    downloadBytes: null,
    totalUsedBytes: used,
    quotaBytes,
    remainingBytes: rem,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled: user.status !== 'disabled',
    dataSource: 'pasarguard',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}

function toMatch(user: PasarGuardUser): PasarGuardMatch {
  const onlineMs = user.online_at ? expireToMs(user.online_at) : null;
  return {
    username: user.username,
    snapshot: normalizePasarGuardUser(user),
    online: onlineMs ? Date.now() - onlineMs < 3 * 60_000 : null,
    lastOnlineAt: onlineMs ? new Date(onlineMs).toISOString() : null,
    deviceLimit: typeof user.hwid_limit === 'number' ? user.hwid_limit : null,
  };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v !== null && v !== undefined && Number.isFinite(n) ? n : null;
}

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}
