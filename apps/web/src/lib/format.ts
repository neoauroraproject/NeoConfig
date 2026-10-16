import type { Locale } from './i18n';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** Split bytes into display parts so the hero can fade the decimals. */
export function bytesParts(bytes: number | null | undefined): { int: string; dec: string; unit: string } | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return null;
  let n = Math.max(0, bytes);
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i += 1;
  }
  const fixed = n >= 100 ? n.toFixed(0) : n.toFixed(2);
  const [int, dec = ''] = fixed.split('.');
  return { int: Number(int).toLocaleString('en-US'), dec: dec ? `.${dec}` : '', unit: UNITS[i] };
}

export function formatBytes(bytes: number | null | undefined): string {
  const p = bytesParts(bytes);
  if (!p) return '—';
  const dec = p.dec.replace(/0+$/, '').replace(/\.$/, '');
  return `${p.int}${dec} ${p.unit}`;
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function formatDate(iso: string | null, locale: Locale): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

export function relativeTime(iso: string | null, locale: Locale): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale === 'fa' ? 'fa' : 'en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86_400), 'day');
}

export function usageFraction(used: number | null, quota: number | null): number | null {
  if (used === null || quota === null || quota <= 0) return null;
  return Math.min(1, Math.max(0, used / quota));
}

/** Persian card numbers read best in groups of four, left to right. */
export function groupCard(num: string) {
  return num.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
}
