import { Injectable } from '@nestjs/common';
import { deriveStatus, expiryFromMs, quotaFromTotalBytes } from '../xui/normalize';
import { NormalizedSubscription } from '../xui/types';

export interface HmPanelConfig {
  /** Panel origin, e.g. https://panel.example.com */
  baseUrl: string;
  /** Per-admin API key (hmp_…) — acts as that admin. */
  apiToken?: string;
  timeoutMs?: number;
}

/** Client object returned by HMPanel's Admin API (docs/admin-api.md in HMPanel). */
export interface HmPanelClient {
  id: string;
  email: string;
  remark: string | null;
  subId: string | null;
  subToken: string | null;
  enable: boolean;
  status: 'active' | 'disabled' | 'expired' | 'limited';
  upBytes: number;
  downBytes: number;
  usedBytes: number;
  totalBytes: number;
  remainingBytes: number | null;
  expiryTime: number;
  lastSyncedAt: string | null;
}

export class HmPanelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Adapter for HMPanel's per-admin API (`/api/v1/*`, `Authorization: Bearer hmp_…`).
 * A reseller's key only ever sees that reseller's customers.
 */
@Injectable()
export class HmPanelClientService {
  async testConnection(cfg: HmPanelConfig): Promise<{
    ok: boolean;
    message: string;
    stats?: { clients: number | null; online: number | null };
  }> {
    try {
      const account = await this.request<{ username: string; role: string }>(cfg, 'GET', '/v1/account');
      const stats = await this.request<{ clients: { total: number } }>(cfg, 'GET', '/v1/stats').catch(() => null);
      return {
        ok: true,
        message: `Connected as ${account.username} (${account.role === 'SUPER_ADMIN' ? 'super admin' : 'reseller'})`,
        stats: { clients: stats?.clients.total ?? null, online: null },
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  /** `key` is whatever the link carries: HMPanel token, 3x-ui subId, email or uuid. */
  async lookup(cfg: HmPanelConfig, key: string): Promise<HmPanelClient | null> {
    try {
      return await this.request<HmPanelClient>(cfg, 'GET', `/v1/clients/lookup?key=${encodeURIComponent(key)}`);
    } catch (err) {
      if (err instanceof HmPanelHttpError && err.status === 404) return null;
      throw err;
    }
  }

  async renew(cfg: HmPanelConfig, clientId: string, plan: { days: number; gb: number }) {
    await this.request(cfg, 'POST', `/v1/clients/${encodeURIComponent(clientId)}/renew`, {
      days: plan.days,
      totalGb: plan.gb,
      resetUsage: true,
    });
    return { ok: true, message: 'Renewed on HMPanel' };
  }

  private async request<T>(cfg: HmPanelConfig, method: string, path: string, body?: unknown): Promise<T> {
    if (!cfg.apiToken) throw new Error('HMPanel API key missing');
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 15_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new HmPanelHttpError(`HMPanel returned a non-JSON response (HTTP ${res.status}) — check the panel URL`, res.status);
    }
    if (!res.ok) {
      const msg = (json as { message?: unknown })?.message;
      throw new HmPanelHttpError(
        typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join(', ') : `HMPanel request failed (HTTP ${res.status})`,
        res.status,
      );
    }
    return json as T;
  }
}

export function normalizeHmPanelClient(c: HmPanelClient): NormalizedSubscription {
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(c.totalBytes);
  const exp = expiryFromMs(c.expiryTime);
  const remaining = quotaKind === 'known' ? Math.max(0, (quotaBytes ?? 0) - c.usedBytes) : null;
  const derived = deriveStatus({
    enabled: c.enable,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: remaining,
    quotaKind,
  });
  // HMPanel's own verdict wins for hard states; ours adds "expiring soon".
  const status = c.status === 'active' ? derived : c.status;
  const name = c.remark || c.email;
  return {
    subscriptionId: c.subToken || c.subId || c.id,
    displayName: name,
    status,
    uploadBytes: c.upBytes,
    downloadBytes: c.downBytes,
    totalUsedBytes: c.usedBytes,
    quotaBytes,
    remainingBytes: remaining,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled: c.enable,
    dataSource: 'hmpanel',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}
