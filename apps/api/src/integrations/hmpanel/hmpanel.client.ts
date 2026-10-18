import { Injectable } from '@nestjs/common';
import { deriveStatus, expiryFromMs, quotaFromTotalBytes } from '../xui/normalize';
import { NormalizedSubscription } from '../xui/types';
import { RenewalTerms, nextQuotaBytes } from '../../panels/renewal-terms';

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
  limitIp?: number | null;
  lastSyncedAt: string | null;
}

export interface HmPanelCard {
  id: string;
  bankName: string | null;
  cardNumber: string;
  cardHolder: string | null;
  iban?: string | null;
  instructions?: string | null;
}

export interface HmPanelProduct {
  id: string;
  name: string;
  kind: string;
  priceToman: number | null;
  priceUsd?: number | null;
  trafficBytes: number;
  durationDays: number;
  status: string;
  visible: boolean;
  renewable: boolean;
  isTest: boolean;
  ipLimitOptions?: number[];
  category?: { id: string; name: string } | null;
}

export interface HmPanelOrder {
  id?: string;
  orderId?: string;
  trackingCode: string;
  status: string;
  rejectReason?: string | null;
  provisionError?: string | null;
  payment?: { rejectReason?: string | null } | null;
}

/** Store order states that mean the renewal went through / was refused. */
export const HM_ORDER_DONE = new Set(['APPROVED', 'PROVISIONING', 'ACTIVE', 'RENEWED']);
export const HM_ORDER_REFUSED = new Set(['REJECTED', 'CANCELLED', 'EXPIRED']);

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

  async renew(cfg: HmPanelConfig, clientId: string, plan: RenewalTerms) {
    const id = encodeURIComponent(clientId);
    const current = await this.request<HmPanelClient>(cfg, 'GET', `/v1/clients/${id}`);
    const quota = nextQuotaBytes(current.totalBytes, plan);
    await this.request(cfg, 'POST', `/v1/clients/${id}/renew`, {
      days: plan.days,
      totalGb: quota / 1024 ** 3,
      resetUsage: plan.mode === 'reset',
    });
    let note = '';
    if (plan.users > 0) {
      // Needs the clients.write scope; a renewal still counts if the key lacks it.
      await this.request(cfg, 'PATCH', `/v1/clients/${id}`, { limitIp: plan.users }).catch((err) => {
        note = ` (user limit not changed: ${err instanceof Error ? err.message : 'failed'})`;
      });
    }
    return { ok: true, message: `Renewed on HMPanel${note}` };
  }

  // ---------- Premium store (module `store`) ----------

  /** Cards the admin's store and bot show for renewals (falls back to the store's general cards). */
  async paymentCards(cfg: HmPanelConfig): Promise<HmPanelCard[]> {
    type Payment = { cards?: HmPanelCard[]; payment?: { cards?: HmPanelCard[] } };
    const read = (p: Payment) => p.cards ?? p.payment?.cards ?? [];
    const renewal = await this.request<Payment>(cfg, 'GET', '/v1/premium/store/payment?surface=renewal').catch(() => null);
    if (renewal && read(renewal).length) return read(renewal);
    return read(await this.request<Payment>(cfg, 'GET', '/v1/premium/store/payment'));
  }

  async storeProducts(cfg: HmPanelConfig): Promise<HmPanelProduct[]> {
    const r = await this.request<HmPanelProduct[] | { data?: HmPanelProduct[] }>(cfg, 'GET', '/v1/premium/store/products?kind=VPN');
    return Array.isArray(r) ? r : r.data ?? [];
  }

  /** Storefront checkout on the admin's own store: HMPanel's bot and panel then review it. */
  async createOrder(
    cfg: HmPanelConfig,
    body: {
      productId: string;
      name: string;
      paymentMethod: 'MANUAL_BANK';
      receiptText?: string;
      receiptImage: string;
      isRenewal: true;
      renewClientId: string;
      limitIp?: number;
    },
  ) {
    return this.request<HmPanelOrder>(cfg, 'POST', '/v1/premium/store/orders', body);
  }

  async getOrder(cfg: HmPanelConfig, id: string) {
    return this.request<HmPanelOrder>(cfg, 'GET', `/v1/premium/store/orders/${encodeURIComponent(id)}`);
  }

  async approveOrder(cfg: HmPanelConfig, id: string) {
    return this.request<HmPanelOrder>(cfg, 'POST', `/v1/premium/store/orders/${encodeURIComponent(id)}/approve`, {});
  }

  async rejectOrder(cfg: HmPanelConfig, id: string, reason: string) {
    return this.request<HmPanelOrder>(cfg, 'POST', `/v1/premium/store/orders/${encodeURIComponent(id)}/reject`, { reason });
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
