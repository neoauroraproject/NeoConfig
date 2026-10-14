const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export type SubscriptionDto = {
  id: string;
  displayName: string;
  color: string | null;
  subIdHint: string | null;
  createdAt: string;
  updatedAt: string;
  refreshError?: string;
  snapshot: {
    status: string;
    uploadBytes: number | null;
    downloadBytes: number | null;
    totalUsedBytes: number | null;
    quotaBytes: number | null;
    remainingBytes: number | null;
    quotaKind: string;
    expiryAt: string | null;
    expiryKind: string;
    enabled: boolean | null;
    dataSource: string;
    syncState: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  } | null;
};

export type Branding = {
  appName: string;
  shortName: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  themeDefault: string;
  defaultLocale: string;
  enabledLocales: string[];
  supportUrl: string | null;
  allowCopyLink: boolean;
  pwaThemeColor: string;
  pwaBgColor: string;
};

function authHeaders(token?: string | null): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function request<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...init } = opts;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...authHeaders(token), ...(init.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  branding: (tenant?: string) =>
    request<Branding>(`/api/v1/branding${tenant ? `?tenant=${tenant}` : ''}`),
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; email: string; role: string } }>(
      '/api/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),
  register: (email: string, password: string, name?: string) =>
    request<{ accessToken: string; user: { id: string; email: string; role: string } }>(
      '/api/v1/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, name }) },
    ),
  me: (token: string) => request('/api/v1/auth/me', { token }),
  listSubscriptions: (token: string) =>
    request<SubscriptionDto[]>('/api/v1/subscriptions', { token }),
  previewSubscription: (token: string, url: string) =>
    request<{ preview: unknown; redactedUrl: string }>('/api/v1/subscriptions/preview', {
      method: 'POST',
      token,
      body: JSON.stringify({ url }),
    }),
  createSubscription: (
    token: string,
    body: { url: string; displayName?: string; color?: string },
  ) =>
    request<SubscriptionDto>('/api/v1/subscriptions', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),
  refreshSubscription: (token: string, id: string) =>
    request<SubscriptionDto>(`/api/v1/subscriptions/${id}/refresh`, {
      method: 'POST',
      token,
    }),
  deleteSubscription: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/v1/subscriptions/${id}`, {
      method: 'DELETE',
      token,
    }),
  renewal: (token: string, id: string) =>
    request<{ available: boolean; reason?: string }>(
      `/api/v1/subscriptions/${id}/renewal`,
      { token },
    ),
  adminOverview: (token: string) => request('/api/v1/admin/overview', { token }),
  adminBranding: (token: string) => request<Branding>('/api/v1/admin/branding', { token }),
  updateBranding: (token: string, body: Partial<Branding>) =>
    request<Branding>('/api/v1/admin/branding', {
      method: 'PATCH',
      token,
      body: JSON.stringify(body),
    }),
  listPanels: (token: string) => request('/api/v1/admin/panels', { token }),
  createPanel: (token: string, body: Record<string, unknown>) =>
    request('/api/v1/admin/panels', {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),
  testPanel: (token: string, id: string) =>
    request(`/api/v1/admin/panels/${id}/test`, { method: 'POST', token }),
  listServers: (token: string) => request('/api/v1/admin/servers', { token }),
  createServer: (token: string, name: string) =>
    request<{
      installCommand: string;
      enrollmentToken: string;
      warning: string;
      server: { id: string; name: string };
    }>('/api/v1/admin/servers', {
      method: 'POST',
      token,
      body: JSON.stringify({ name }),
    }),
  hmpanel: (token: string) => request('/api/v1/admin/hmpanel', { token }),
  audit: (token: string) => request('/api/v1/admin/audit', { token }),
};
