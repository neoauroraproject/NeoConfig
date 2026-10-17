/** What one approved renewal does to an account, independent of the panel. */
export interface RenewalTerms {
  /** Days added to the later of now and the current expiry (0 = keep expiry). */
  days: number;
  /** add: GB added on top; reset: the new total (0 = unlimited). */
  gb: number;
  /** Allowed simultaneous users/devices; 0 = leave as is. */
  users: number;
  /** add = extend time and data, keep usage. reset = new period: set data, zero usage. */
  mode: 'add' | 'reset';
}

const GB = 1024 ** 3;
const DAY = 86_400_000;

export function normalizeTerms(t: Partial<RenewalTerms>): RenewalTerms {
  return {
    days: Math.max(0, Math.round(Number(t.days) || 0)),
    gb: Math.max(0, Number(t.gb) || 0),
    users: Math.max(0, Math.round(Number(t.users) || 0)),
    mode: t.mode === 'reset' ? 'reset' : 'add',
  };
}

/** New expiry in ms (0 stays "never expires" unless days are added). */
export function nextExpiryMs(currentMs: number, days: number, now = Date.now()): number {
  if (days <= 0) return currentMs;
  const base = currentMs > now ? currentMs : now;
  return base + days * DAY;
}

/** New quota in bytes; 0 means unlimited. An unlimited account stays unlimited when adding. */
export function nextQuotaBytes(currentBytes: number, t: RenewalTerms): number {
  if (t.mode === 'reset') return t.gb > 0 ? Math.round(t.gb * GB) : 0;
  if (currentBytes <= 0) return 0;
  return currentBytes + Math.round(t.gb * GB);
}

export function describeTerms(t: RenewalTerms): string {
  const parts: string[] = [];
  if (t.days) parts.push(`+${t.days} days`);
  if (t.mode === 'add' && t.gb) parts.push(`+${t.gb} GB`);
  if (t.mode === 'reset') parts.push(t.gb ? `${t.gb} GB (usage reset)` : 'unlimited (usage reset)');
  if (t.users) parts.push(`${t.users} user${t.users > 1 ? 's' : ''}`);
  return parts.join(', ');
}
