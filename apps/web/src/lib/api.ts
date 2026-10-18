// Same-origin by default: Next rewrites /api/v1/* to the API, and in production
// the reverse proxy does the same for every custom domain.
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export type SubStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'limited'
  | 'on_hold'
  | 'disabled'
  | 'unknown';

export type NormalizedSnapshot = {
  subscriptionId: string;
  displayName: string;
  status: SubStatus;
  uploadBytes: number | null;
  downloadBytes: number | null;
  totalUsedBytes: number | null;
  quotaBytes: number | null;
  remainingBytes: number | null;
  quotaKind: 'known' | 'unlimited' | 'unknown';
  expiryAt: string | null;
  expiryKind: 'known' | 'none' | 'unknown';
  enabled: boolean | null;
  dataSource: string;
  syncState: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export type LookupResponse = {
  subId: string | null;
  redactedUrl: string;
  snapshot: NormalizedSnapshot;
  online: boolean | null;
  lastOnlineAt: string | null;
  renewable: boolean;
  /** Daily readings the server took (lookups + background checks), oldest first. */
  history?: Array<{ d: string; used: number }>;
  /** Allowed simultaneous devices (0 = unlimited). */
  deviceLimit?: number | null;
  /** Devices connected right now. */
  devicesOnline?: number | null;
  /** Devices registered under an HWID limit (exact, 3x-ui 3.7+). */
  devicesRegistered?: number | null;
  deviceMode?: 'hwid' | 'ip' | null;
  serviceKind?: 'xui' | 'pasarguard' | null;
};

export type RenewalPlan = {
  id: string;
  title: string;
  days: number;
  gb: number;
  price: string;
  /** Allowed simultaneous users; 0 = unchanged. */
  users: number;
  mode: 'add' | 'reset';
  /** HMPanel store product (renewals through HMPanel). */
  productId?: string;
  /** Only for 3x-ui or PasarGuard services; missing = any. */
  service?: 'xui' | 'pasarguard';
  category?: string;
};

export const THEME_IDS = ['mist', 'graphite', 'sage', 'moss', 'pearl'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type Branding = {
  slug: string;
  appName: string;
  shortName: string;
  tagline: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  theme: ThemeId;
  /** Themes the customer may pick from (default first). */
  themes?: ThemeId[];
  defaultLocale: string;
  supportUrl: string | null;
  supportTelegram: string | null;
  contactEmail: string | null;
  allowCopyLink: boolean;
  /** Customers can buy a new service in the app. */
  purchase?: boolean;
  renewal: {
    cardNumber: string;
    cardHolder: string | null;
    bankName: string | null;
    note: string | null;
    plans: RenewalPlan[];
  } | null;
};

export type PublicRenewal = {
  id: string;
  /** renewal, or purchase (a new service bought in the app) */
  kind?: 'renewal' | 'purchase';
  /** Purchases: the new subscription link once HMPanel delivered it. */
  subscriptionUrl?: string | null;
  subId: string;
  planTitle: string;
  price: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...init } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (Array.isArray(body.message) ? body.message.join(', ') : body.message) ||
      body.error ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const publicApi = {
  branding: (tenant: string) =>
    request<Branding>(`/api/v1/public/branding?tenant=${encodeURIComponent(tenant)}`),

  lookup: (url: string, tenant: string) =>
    request<LookupResponse>('/api/v1/public/lookup', {
      method: 'POST',
      body: JSON.stringify({ url, tenant }),
    }),

  pushKey: () => request<{ publicKey: string }>('/api/v1/public/push/key'),

  pushSubscribe: (tenant: string, subscription: PushSubscriptionJSON, accounts: PushFollow[]) =>
    request<{ ok: boolean }>('/api/v1/public/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ tenant, subscription, subIds: accounts.map((a) => a.subId), accounts }),
    }),

  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>('/api/v1/public/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  createRenewal: (body: {
    tenant: string;
    url: string;
    planId: string;
    receipt: string;
    payerName?: string;
    payerNote?: string;
    deviceEndpoint?: string;
  }) =>
    request<PublicRenewal>('/api/v1/public/renewals', { method: 'POST', body: JSON.stringify(body) }),

  createPurchase: (body: { tenant: string; planId: string; receipt: string; payerName?: string; payerNote?: string; deviceEndpoint?: string }) =>
    request<PublicRenewal>('/api/v1/public/purchases', { method: 'POST', body: JSON.stringify(body) }),

  renewalStatus: (ids: string[]) =>
    request<PublicRenewal[]>('/api/v1/public/renewals/status', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};

/** A subscription this device follows; the link lets the server send expiry reminders. */
export interface PushFollow {
  subId: string;
  url: string;
}
