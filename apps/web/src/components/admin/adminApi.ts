import { RenewalPlan, ThemeId, request } from '@/lib/api';

export type Role = 'SUPER_ADMIN' | 'ORG_ADMIN' | 'RESELLER' | 'USER';

export type AdminBrand = {
  id: string;
  slug: string;
  appName: string;
  shortName: string;
  tagline: string | null;
  logoUrl: string | null;
  iconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  theme: ThemeId;
  themeChoices: ThemeId[];
  renewalVia: 'local' | 'hmpanel';
  renewalPanelId: string | null;
  defaultLocale: string;
  supportUrl: string | null;
  supportTelegram: string | null;
  contactEmail: string | null;
  allowCopyLink: boolean;
  active: boolean;
  isDefault: boolean;
  renewalEnabled: boolean;
  expiryRemindersEnabled: boolean;
  telegramChatId: string | null;
  telegramConfigured: boolean;
  cardNumber: string | null;
  cardHolder: string | null;
  bankName: string | null;
  renewalNote: string | null;
  plans: RenewalPlan[];
  panelIds: string[];
  owner: { id: string; email: string; name: string | null } | null;
  domains: Array<{
    id: string;
    domain: string;
    dnsOk: boolean | null;
    sslOk: boolean | null;
    checkMessage: string | null;
    lastCheckAt: string | null;
  }>;
  pendingRenewals: number;
  devices: number;
  createdAt: string;
};

export type Panel = {
  id: string;
  name: string;
  type: 'xui' | 'pasarguard' | 'hmpanel';
  baseUrl: string;
  authMode: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: string;
};

export type Overview = {
  role: Role;
  brands: Array<{ id: string; appName: string; primaryColor: string; slug: string; active: boolean }>;
  panels: Array<{ id: string; name: string; type: string; healthy: boolean | null; lastTestAt: string | null; message: string | null }>;
  pendingRenewals: number;
  approvedThisMonth: number;
  devices: number;
  lookups14d: Array<{ date: string; found: number; missed: number }>;
  lookupsTotal14d: number;
  recentRenewals: Array<{
    id: string;
    brand: { appName: string; primaryColor: string };
    displayName: string | null;
    planTitle: string;
    price: string;
    status: string;
    createdAt: string;
  }>;
};

export type AdminRenewal = {
  id: string;
  brand: { id: string; appName: string; primaryColor: string };
  subId: string;
  displayName: string | null;
  planTitle: string;
  days: number;
  gb: number;
  users: number;
  mode: string;
  price: string;
  payerName: string | null;
  payerNote: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
  canApply: boolean;
  via: 'local' | 'hmpanel';
  externalCode: string | null;
  appliedOnPanel: boolean | null;
  applyMessage: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type HmCard = { id: string; bankName: string | null; cardNumber: string; cardHolder: string | null };
export type HmProduct = {
  id: string;
  name: string;
  priceToman: number | null;
  trafficBytes: number;
  durationDays: number;
  ipLimitOptions?: number[];
  providerId?: string | null;
  category?: { id: string; name: string } | null;
  panel?: { id: string; name: string } | null;
};

export type Member = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  brands: Array<{ id: string; appName: string }>;
  createdAt: string;
  isYou: boolean;
};

export type Me = { id: string; email: string; name: string | null; role: Role };

const API = process.env.NEXT_PUBLIC_API_URL || '';
const TOKEN_KEY = 'nc.admin.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

const tk = () => getToken();
const json = (body: unknown) => JSON.stringify(body);

export const adminApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: Me }>('/api/v1/auth/login', {
      method: 'POST',
      body: json({ email, password }),
    }),
  me: () => request<Me>('/api/v1/auth/me', { token: tk() }),
  overview: () => request<Overview>('/api/v1/admin/overview', { token: tk() }),

  brands: () => request<AdminBrand[]>('/api/v1/admin/brands', { token: tk() }),
  createBrand: (body: Partial<AdminBrand>) =>
    request<AdminBrand>('/api/v1/admin/brands', { method: 'POST', token: tk(), body: json(body) }),
  updateBrand: (id: string, body: Partial<AdminBrand>) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}`, { method: 'PATCH', token: tk(), body: json(body) }),
  deleteBrand: (id: string) => request(`/api/v1/admin/brands/${id}`, { method: 'DELETE', token: tk() }),
  addDomain: (id: string, domain: string) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}/domains`, { method: 'POST', token: tk(), body: json({ domain }) }),
  removeDomain: (id: string, domainId: string) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}/domains/${domainId}`, { method: 'DELETE', token: tk() }),
  issueSsl: (id: string, domainId: string) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}/domains/${domainId}/ssl`, { method: 'POST', token: tk() }),
  checkDomain: (id: string, domainId: string) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}/domains/${domainId}/check`, { method: 'POST', token: tk() }),
  telegramTest: (id: string) =>
    request<{ ok: boolean; buttons?: boolean; buttonsMessage?: string }>(`/api/v1/admin/brands/${id}/telegram/test`, { method: 'POST', token: tk() }),
  uploadLogo: (id: string, dataUrl: string) =>
    request<AdminBrand>(`/api/v1/admin/brands/${id}/logo`, { method: 'POST', token: tk(), body: json({ dataUrl }) }),
  hmpanelPanels: (id: string) =>
    request<Array<{ id: string; name: string; host: string }>>(`/api/v1/admin/brands/${id}/hmpanel`, { token: tk() }),
  hmpanelCards: (id: string, panelId: string) => request<HmCard[]>(`/api/v1/admin/brands/${id}/hmpanel/${panelId}/cards`, { token: tk() }),
  hmpanelProducts: (id: string, panelId: string) =>
    request<HmProduct[]>(`/api/v1/admin/brands/${id}/hmpanel/${panelId}/products`, { token: tk() }),
  removeLogo: (id: string) => request<AdminBrand>(`/api/v1/admin/brands/${id}/logo`, { method: 'DELETE', token: tk() }),
  broadcast: (id: string, title: string, body: string) =>
    request<{ sent: number; total: number }>(`/api/v1/admin/brands/${id}/push`, {
      method: 'POST',
      token: tk(),
      body: json({ title, body }),
    }),

  panels: () => request<Panel[]>('/api/v1/admin/panels', { token: tk() }),
  createPanel: (body: Record<string, string | undefined>) =>
    request<Panel>('/api/v1/admin/panels', { method: 'POST', token: tk(), body: json(body) }),
  updatePanel: (id: string, body: Record<string, string | undefined>) =>
    request<Panel>(`/api/v1/admin/panels/${id}`, { method: 'PATCH', token: tk(), body: json(body) }),
  testPanel: (id: string) =>
    request<{ ok: boolean; message: string; stats?: { clients: number | null; online: number | null } }>(
      `/api/v1/admin/panels/${id}/test`,
      { method: 'POST', token: tk() },
    ),
  deletePanel: (id: string) => request(`/api/v1/admin/panels/${id}`, { method: 'DELETE', token: tk() }),

  renewals: (status?: string) =>
    request<AdminRenewal[]>(`/api/v1/admin/renewals${status ? `?status=${status}` : ''}`, { token: tk() }),
  approve: (id: string, apply: boolean, note?: string) =>
    request<{ ok: boolean; appliedOnPanel: boolean | null; applyMessage: string | null; notified: number }>(
      `/api/v1/admin/renewals/${id}/approve`,
      { method: 'POST', token: tk(), body: json({ apply, note }) },
    ),
  reject: (id: string, note?: string) =>
    request<{ ok: boolean; notified: number }>(`/api/v1/admin/renewals/${id}/reject`, {
      method: 'POST',
      token: tk(),
      body: json({ note }),
    }),
  receiptUrl: async (id: string) => {
    const res = await fetch(`${API}/api/v1/admin/renewals/${id}/receipt`, {
      headers: { Authorization: `Bearer ${tk()}` },
    });
    if (!res.ok) throw new Error('receipt');
    return URL.createObjectURL(await res.blob());
  },

  team: () => request<Member[]>('/api/v1/admin/team', { token: tk() }),
  createMember: (body: { email: string; password: string; name?: string; role?: string; brandIds?: string[] }) =>
    request('/api/v1/admin/team', { method: 'POST', token: tk(), body: json(body) }),
  updateMember: (id: string, body: { name?: string; password?: string; brandIds?: string[] }) =>
    request(`/api/v1/admin/team/${id}`, { method: 'PATCH', token: tk(), body: json(body) }),
  deleteMember: (id: string) => request(`/api/v1/admin/team/${id}`, { method: 'DELETE', token: tk() }),
};
