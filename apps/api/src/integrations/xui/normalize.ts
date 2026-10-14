import {
  NormalizedExpiryKind,
  NormalizedQuotaKind,
  NormalizedStatus,
  NormalizedSubscription,
  SubscriptionUserInfo,
  XuiClient,
  XuiClientTraffic,
  XuiSubInfoViewModel,
} from './types';

const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000;
const GB = 1024 * 1024 * 1024;

export function parseSubscriptionUserInfo(
  header: string | null | undefined,
): SubscriptionUserInfo | null {
  if (!header || typeof header !== 'string') return null;
  // Format used by many 3x-ui / Clash-style subscription endpoints:
  // upload=123; download=456; total=789; expire=1710000000
  const out: SubscriptionUserInfo = {};
  for (const part of header.split(';')) {
    const [rawKey, rawVal] = part.split('=').map((s) => s.trim());
    if (!rawKey || rawVal === undefined) continue;
    const key = rawKey.toLowerCase();
    const num = Number(rawVal);
    if (!Number.isFinite(num)) continue;
    if (key === 'upload') out.upload = num;
    if (key === 'download') out.download = num;
    if (key === 'total') out.total = num;
    if (key === 'expire') out.expire = num;
  }
  if (
    out.upload === undefined &&
    out.download === undefined &&
    out.total === undefined &&
    out.expire === undefined
  ) {
    return null;
  }
  return out;
}

export function deriveStatus(opts: {
  enabled: boolean | null;
  expiryAtMs: number | null;
  expiryKind: NormalizedExpiryKind;
  remainingBytes: number | null;
  quotaKind: NormalizedQuotaKind;
  now?: number;
}): NormalizedStatus {
  if (opts.enabled === false) return 'disabled';
  const now = opts.now ?? Date.now();
  if (opts.expiryKind === 'known' && opts.expiryAtMs !== null) {
    if (opts.expiryAtMs <= now) return 'expired';
    if (opts.expiryAtMs - now <= EXPIRING_SOON_MS) return 'expiring_soon';
  }
  if (
    opts.quotaKind === 'known' &&
    opts.remainingBytes !== null &&
    opts.remainingBytes <= 0
  ) {
    return 'expired';
  }
  if (opts.enabled === true) return 'active';
  if (opts.enabled === null && opts.expiryKind === 'unknown' && opts.quotaKind === 'unknown') {
    return 'unknown';
  }
  return 'active';
}

function quotaFromTotalBytes(total: number | null | undefined): {
  quotaBytes: number | null;
  quotaKind: NormalizedQuotaKind;
} {
  if (total === null || total === undefined) {
    return { quotaBytes: null, quotaKind: 'unknown' };
  }
  if (total === 0) {
    return { quotaBytes: null, quotaKind: 'unlimited' };
  }
  if (total > 0) {
    return { quotaBytes: total, quotaKind: 'known' };
  }
  return { quotaBytes: null, quotaKind: 'unknown' };
}

function expiryFromMs(ms: number | null | undefined): {
  expiryAt: string | null;
  expiryAtMs: number | null;
  expiryKind: NormalizedExpiryKind;
} {
  if (ms === null || ms === undefined) {
    return { expiryAt: null, expiryAtMs: null, expiryKind: 'unknown' };
  }
  // Documented: expiryTime=0 unlimited; negative first-use duration.
  if (ms === 0) {
    return { expiryAt: null, expiryAtMs: null, expiryKind: 'none' };
  }
  if (ms < 0) {
    return { expiryAt: null, expiryAtMs: null, expiryKind: 'unknown' };
  }
  // Support seconds vs milliseconds
  const normalized = ms < 1e12 ? ms * 1000 : ms;
  return {
    expiryAt: new Date(normalized).toISOString(),
    expiryAtMs: normalized,
    expiryKind: 'known',
  };
}

function remaining(
  quotaKind: NormalizedQuotaKind,
  quotaBytes: number | null,
  used: number | null,
): number | null {
  if (quotaKind !== 'known' || quotaBytes === null || used === null) return null;
  return Math.max(0, quotaBytes - used);
}

export function normalizeFromClientTraffic(
  traffic: XuiClientTraffic,
  opts?: { displayName?: string; subscriptionId?: string },
): NormalizedSubscription {
  const upload = Number(traffic.up);
  const download = Number(traffic.down);
  const used =
    Number.isFinite(upload) && Number.isFinite(download)
      ? upload + download
      : null;
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(
    Number.isFinite(traffic.total) ? Number(traffic.total) : null,
  );
  const rem = remaining(quotaKind, quotaBytes, used);
  const exp = expiryFromMs(traffic.expiryTime);
  const enabled = typeof traffic.enable === 'boolean' ? traffic.enable : null;
  const status = deriveStatus({
    enabled,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: rem,
    quotaKind,
  });

  return {
    subscriptionId: opts?.subscriptionId ?? traffic.subId ?? traffic.email,
    displayName: opts?.displayName ?? traffic.email,
    status,
    uploadBytes: Number.isFinite(upload) ? upload : null,
    downloadBytes: Number.isFinite(download) ? download : null,
    totalUsedBytes: used,
    quotaBytes,
    remainingBytes: rem,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled,
    dataSource: '3x-ui:clients/traffic',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}

export function normalizeFromClient(
  client: XuiClient,
  traffic?: XuiClientTraffic | null,
): NormalizedSubscription {
  if (traffic) {
    return normalizeFromClientTraffic(traffic, {
      displayName: client.comment || client.email,
      subscriptionId: client.subId || client.email,
    });
  }

  // totalGB is in GB per API schema; convert to bytes. 0 => unlimited.
  const totalGb = Number(client.totalGB);
  let quotaBytes: number | null = null;
  let quotaKind: NormalizedQuotaKind = 'unknown';
  if (Number.isFinite(totalGb)) {
    if (totalGb === 0) {
      quotaKind = 'unlimited';
    } else if (totalGb > 0) {
      quotaKind = 'known';
      quotaBytes = Math.round(totalGb * GB);
    }
  }

  const exp = expiryFromMs(client.expiryTime);
  const enabled = typeof client.enable === 'boolean' ? client.enable : null;
  const status = deriveStatus({
    enabled,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: null,
    quotaKind,
  });

  return {
    subscriptionId: client.subId || client.email,
    displayName: client.comment || client.email,
    status,
    uploadBytes: null,
    downloadBytes: null,
    totalUsedBytes: null,
    quotaBytes,
    remainingBytes: null,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled,
    dataSource: '3x-ui:clients/get',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}

export function normalizeFromSubInfo(
  info: XuiSubInfoViewModel,
  headers?: SubscriptionUserInfo | null,
): NormalizedSubscription {
  const upload = pickNum(info.up, info.upload, headers?.upload);
  const download = pickNum(info.down, info.download, headers?.download);
  const used =
    upload !== null && download !== null
      ? upload + download
      : pickNum(info.used);
  const total = pickNum(info.total, headers?.total);
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(total);
  const rem =
    remaining(quotaKind, quotaBytes, used) ??
    (typeof info.remaining === 'number' && Number.isFinite(info.remaining)
      ? info.remaining
      : null);
  const exp = expiryFromMs(
    pickNum(info.expiryTime, info.expire, headers?.expire),
  );
  const enabled = typeof info.enable === 'boolean' ? info.enable : null;
  const status = deriveStatus({
    enabled,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: rem,
    quotaKind,
  });

  return {
    subscriptionId: String(info.subId ?? info.email ?? 'unknown'),
    displayName: String(info.email ?? info.subId ?? 'Subscription'),
    status,
    uploadBytes: upload,
    downloadBytes: download,
    totalUsedBytes: used,
    quotaBytes,
    remainingBytes: rem,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled,
    dataSource: '3x-ui:sub?format=info',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}

export function normalizeFromUserInfoHeaders(
  headers: SubscriptionUserInfo,
  subId?: string,
): NormalizedSubscription {
  const upload = headers.upload ?? null;
  const download = headers.download ?? null;
  const used =
    upload !== null && download !== null ? upload + download : null;
  const { quotaBytes, quotaKind } = quotaFromTotalBytes(headers.total ?? null);
  const rem = remaining(quotaKind, quotaBytes, used);
  // subscription-userinfo expire is typically Unix seconds
  const exp = expiryFromMs(
    headers.expire !== undefined
      ? headers.expire < 1e12
        ? headers.expire * 1000
        : headers.expire
      : null,
  );
  const status = deriveStatus({
    enabled: null,
    expiryAtMs: exp.expiryAtMs,
    expiryKind: exp.expiryKind,
    remainingBytes: rem,
    quotaKind,
  });

  return {
    subscriptionId: subId ?? 'unknown',
    displayName: subId ?? 'Subscription',
    status,
    uploadBytes: upload,
    downloadBytes: download,
    totalUsedBytes: used,
    quotaBytes,
    remainingBytes: rem,
    quotaKind,
    expiryAt: exp.expiryAt,
    expiryKind: exp.expiryKind,
    enabled: null,
    dataSource: 'subscription-userinfo',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  };
}

export function unknownSnapshot(
  subscriptionId: string,
  displayName: string,
  error?: string,
): NormalizedSubscription {
  return {
    subscriptionId,
    displayName,
    status: 'unknown',
    uploadBytes: null,
    downloadBytes: null,
    totalUsedBytes: null,
    quotaBytes: null,
    remainingBytes: null,
    quotaKind: 'unknown',
    expiryAt: null,
    expiryKind: 'unknown',
    enabled: null,
    dataSource: 'unknown',
    syncState: error ? 'failed' : 'never',
    lastSyncAt: null,
    lastSyncError: error ?? null,
  };
}

function pickNum(...vals: Array<unknown>): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}
