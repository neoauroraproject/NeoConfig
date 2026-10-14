import { Locale, t } from './i18n';

export function formatBytes(bytes: number | null | undefined, locale: Locale): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return t(locale, 'unknown');
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  const formatted = new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : locale === 'ar' ? 'ar' : 'en', {
    maximumFractionDigits: n >= 100 ? 0 : 1,
  }).format(n);
  return `${formatted} ${units[i]}`;
}

export function usagePercent(
  used: number | null,
  quota: number | null,
  quotaKind: string,
): number | null {
  if (quotaKind !== 'known' || used === null || quota === null || quota <= 0) return null;
  return Math.min(100, Math.max(0, (used / quota) * 100));
}

export function expiryLabel(
  expiryAt: string | null,
  expiryKind: string,
  locale: Locale,
): string {
  if (expiryKind === 'none') return t(locale, 'noExpiry');
  if (expiryKind !== 'known' || !expiryAt) return t(locale, 'unknown');
  const ms = new Date(expiryAt).getTime() - Date.now();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return t(locale, 'expiresToday');
  if (days > 0) return t(locale, 'daysLeft', { n: days });
  return t(locale, 'expiredDaysAgo', { n: Math.abs(days) });
}

export function statusLabel(status: string, locale: Locale) {
  switch (status) {
    case 'active':
      return t(locale, 'active');
    case 'expiring_soon':
      return t(locale, 'expiringSoon');
    case 'expired':
      return t(locale, 'expired');
    case 'disabled':
      return t(locale, 'disabled');
    default:
      return t(locale, 'unknown');
  }
}
