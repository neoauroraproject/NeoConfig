/**
 * Types mapped from docs/api310.json (3X-UI Panel API 3.x).
 * Do not invent fields — only document-backed shapes.
 */

/** components.schemas.Msg */
export interface XuiMsg<T = unknown> {
  success: boolean;
  msg: string;
  obj: T;
}

/**
 * components.schemas.ClientTraffic
 * Traffic counters for a client identified by email.
 */
export interface XuiClientTraffic {
  id: number;
  inboundId: number;
  enable: boolean;
  email: string;
  up: number;
  down: number;
  /** Total quota in bytes; 0 typically means unlimited in 3x-ui. */
  total: number;
  /** Unix milliseconds; 0 = unlimited / no expiry. */
  expiryTime: number;
  lastOnline: number;
  lastSubFetch: number;
  reset: number;
  resetDay: number;
  resetWeekday: number;
  resetMax: number;
  resetCount: number;
  subId: string;
  uuid: string;
}

/** Subset of components.schemas.Client / ClientRecord used for sync. */
export interface XuiClient {
  email: string;
  enable: boolean;
  expiryTime: number;
  /** Total traffic limit in GB (API field totalGB). */
  totalGB: number;
  subId: string;
  comment?: string;
  id?: string | number;
  uuid?: string;
  reset?: number;
  resetDay?: number;
  resetWeekday?: number;
  resetMax?: number;
}

/** components.schemas.ClientRenewalPreview */
export interface XuiClientRenewalPreview {
  canRenew: boolean;
  delayedStart: boolean;
  nextExpiry: string;
  renewAt: string;
  renewals: number;
  suggestedExpiry: string;
  suggestedExpiryTime: number;
  timeZone: string;
  validThrough: string;
}

/**
 * Response shape for GET /{subPath}{subid}?format=info
 * Documented as "page view-model as JSON (traffic, expiry, online status; no links)".
 * Field names vary by panel theme; we accept documented + commonly emitted keys.
 */
export interface XuiSubInfoViewModel {
  email?: string;
  enable?: boolean;
  expiryTime?: number;
  expire?: number;
  up?: number;
  down?: number;
  total?: number;
  upload?: number;
  download?: number;
  used?: number;
  remaining?: number;
  online?: boolean;
  lastOnline?: number;
  subId?: string;
  [key: string]: unknown;
}

export type SubscriptionUserInfo = {
  upload?: number;
  download?: number;
  total?: number;
  expire?: number;
};

export type NormalizedQuotaKind = 'known' | 'unlimited' | 'unknown';
export type NormalizedExpiryKind = 'known' | 'none' | 'unknown';
export type NormalizedStatus =
  | 'active'
  | 'expiring_soon'
  | 'expired'
  | 'disabled'
  | 'unknown';
export type NormalizedSyncState = 'never' | 'ok' | 'stale' | 'failed';

export interface NormalizedSubscription {
  subscriptionId: string;
  displayName: string;
  status: NormalizedStatus;
  uploadBytes: number | null;
  downloadBytes: number | null;
  totalUsedBytes: number | null;
  quotaBytes: number | null;
  remainingBytes: number | null;
  quotaKind: NormalizedQuotaKind;
  expiryAt: string | null;
  expiryKind: NormalizedExpiryKind;
  enabled: boolean | null;
  dataSource: string;
  syncState: NormalizedSyncState;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}
