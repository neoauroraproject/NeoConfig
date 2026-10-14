import { Injectable, Logger } from '@nestjs/common';
import {
  SubscriptionUserInfo,
  XuiClient,
  XuiClientRenewalPreview,
  XuiClientTraffic,
  XuiMsg,
  XuiSubInfoViewModel,
} from './types';
import { parseSubscriptionUserInfo } from './normalize';

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

    const url = this.join(cfg.baseUrl, '/login');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: cfg.username,
        password: cfg.password,
      }),
      redirect: 'manual',
    });

    const body = (await res.json().catch(() => null)) as XuiMsg | null;
    if (!body?.success) {
      throw new Error(body?.msg || 'Panel login failed');
    }

    const setCookie = res.headers.get('set-cookie') || '';
    // Documented cookie name: 3x-ui
    const match = setCookie.match(/3x-ui=([^;]+)/);
    if (!match) {
      throw new Error('Panel login succeeded but session cookie was not returned');
    }
    return { cookie: `3x-ui=${match[1]}` };
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
        throw new Error('Unexpected redirect from panel API');
      }
      const json = (await res.json()) as XuiMsg<T>;
      return json;
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

// Re-export for consumers that import user-info parsing from the client module path
export { parseSubscriptionUserInfo };
export type { SubscriptionUserInfo };
