'use client';

import type { LookupResponse, NormalizedSnapshot } from './api';

/**
 * Subscriptions live only on this device (localStorage), keyed per storefront
 * so two brands on one phone never mix accounts.
 */
export type SavedAccount = {
  id: string;
  url: string;
  label: string | null;
  snapshot: NormalizedSnapshot;
  online: boolean | null;
  lastOnlineAt: string | null;
  renewable: boolean;
  addedAt: string;
  /** One reading of total usage per day, newest last (max 30). */
  history: Array<{ d: string; used: number }>;
  deviceLimit?: number | null;
  devicesOnline?: number | null;
  devicesRegistered?: number | null;
  deviceMode?: 'hwid' | 'ip' | null;
  serviceKind?: 'xui' | 'pasarguard' | null;
  storeCategoryId?: string | null;
  panelId?: string | null;
  sourcePanelRef?: string | null;
  stale?: boolean;
};

export type AccountState = { accounts: SavedAccount[]; activeId: string | null };

export type TrackedRenewal = { id: string; accountId: string };

/** Local calendar day — an Iranian user's midnight is not UTC midnight. */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const key = (tenant: string) => `nc.accounts.v1.${tenant}`;
const renewKey = (tenant: string) => `nc.renewals.v1.${tenant}`;

function read<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(k: string, value: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch {
    /* storage full or blocked — the app still works for this session */
  }
}

export function loadAccounts(tenant: string): AccountState {
  const state = read<AccountState>(key(tenant), { accounts: [], activeId: null });
  if (!state.accounts.some((a) => a.id === state.activeId)) {
    state.activeId = state.accounts[0]?.id ?? null;
  }
  return state;
}

export function saveAccounts(tenant: string, state: AccountState) {
  write(key(tenant), state);
}

export function accountId(res: LookupResponse, url: string) {
  return res.subId || res.snapshot.subscriptionId || url;
}

export function upsertAccount(
  state: AccountState,
  url: string,
  res: LookupResponse,
): AccountState {
  const id = accountId(res, url);
  const existing = state.accounts.find((a) => a.id === id);
  const next: SavedAccount = {
    id,
    url,
    label: existing?.label ?? null,
    snapshot: res.snapshot,
    online: res.online,
    lastOnlineAt: res.lastOnlineAt,
    renewable: res.renewable,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    history: recordUsage(mergeHistory(existing?.history ?? [], res.history ?? []), res.snapshot.totalUsedBytes),
    deviceLimit: res.deviceLimit ?? null,
    devicesOnline: res.devicesOnline ?? null,
    devicesRegistered: res.devicesRegistered ?? null,
    deviceMode: res.deviceMode ?? null,
    serviceKind: res.serviceKind ?? null,
    storeCategoryId: res.storeCategoryId ?? null,
    panelId: res.panelId ?? null,
    sourcePanelRef: res.sourcePanelRef ?? null,
    stale: false,
  };
  const accounts = existing
    ? state.accounts.map((a) => (a.id === id ? next : a))
    : [...state.accounts, next];
  return { accounts, activeId: id };
}

/** Days this device missed come from the server's readings; days it saw keep its own. */
function mergeHistory(local: SavedAccount['history'], server: SavedAccount['history']) {
  if (!server.length) return local;
  const byDay = new Map(server.map((h) => [h.d, h.used]));
  for (const h of local) byDay.set(h.d, h.used);
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, used]) => ({ d, used }))
    .slice(-30);
}

function recordUsage(history: SavedAccount['history'], used: number | null) {
  if (used === null) return history;
  const d = localDay();
  const rest = history.filter((h) => h.d !== d);
  return [...rest, { d, used }].slice(-30);
}

/** Daily consumption from cumulative readings; a drop means the quota was reset. */
export function dailyUsage(history: SavedAccount['history'], days = 14) {
  const byDay = new Map(history.map((h) => [h.d, h.used]));
  const out: Array<{ d: string; bytes: number | null }> = [];
  let prev: number | null = null;
  const start = new Date();
  start.setDate(start.getDate() - days);
  const seed = history.filter((h) => h.d < localDay(start)).pop();
  if (seed) prev = seed.used;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const d = localDay(date);
    const v = byDay.get(d);
    if (v === undefined) {
      out.push({ d, bytes: null });
      continue;
    }
    out.push({ d, bytes: prev === null ? null : v >= prev ? v - prev : v });
    prev = v;
  }
  return out;
}

export function loadRenewals(tenant: string): TrackedRenewal[] {
  return read<TrackedRenewal[]>(renewKey(tenant), []);
}

export function saveRenewals(tenant: string, list: TrackedRenewal[]) {
  write(renewKey(tenant), list.slice(-20));
}
