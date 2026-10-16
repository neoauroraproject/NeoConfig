import { NormalizedSubscription } from '../integrations/xui/types';

export type ReminderKind = 'days' | 'data';

export const REMINDER_DAYS_LEFT = 3;
export const REMINDER_DATA_FRACTION = 0.1;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReminderCheck {
  /** Thresholds the account is under right now. */
  due: ReminderKind[];
  /** Whole days left (rounded up), when the expiry is known. */
  daysLeft: number | null;
  /** Remaining share of the quota (0–1), when the quota is known. */
  dataLeft: number | null;
}

type Snapshot = Pick<
  NormalizedSubscription,
  'status' | 'expiryAt' | 'expiryKind' | 'quotaKind' | 'quotaBytes' | 'remainingBytes' | 'totalUsedBytes'
>;

/** Which reminder thresholds an account has crossed. Disabled and not-yet-started accounts get none. */
export function checkThresholds(s: Snapshot, now: Date): ReminderCheck {
  const due: ReminderKind[] = [];
  if (s.status === 'disabled' || s.status === 'on_hold') return { due, daysLeft: null, dataLeft: null };

  let daysLeft: number | null = null;
  const expiry = s.expiryKind === 'known' && s.expiryAt ? Date.parse(s.expiryAt) : NaN;
  if (Number.isFinite(expiry)) {
    daysLeft = Math.max(0, Math.ceil((expiry - now.getTime()) / DAY_MS));
    if (expiry - now.getTime() <= REMINDER_DAYS_LEFT * DAY_MS) due.push('days');
  }

  let dataLeft: number | null = null;
  if (s.quotaKind === 'known' && s.quotaBytes && s.quotaBytes > 0) {
    const remaining = s.remainingBytes ?? (s.totalUsedBytes != null ? s.quotaBytes - s.totalUsedBytes : null);
    if (remaining != null) {
      dataLeft = Math.max(0, Math.min(1, remaining / s.quotaBytes));
      if (dataLeft <= REMINDER_DATA_FRACTION) due.push('data');
    }
  }
  return { due, daysLeft, dataLeft };
}

/**
 * Compare what is due with what was already sent: send each threshold once,
 * and re-arm a threshold the account has climbed back above (it was renewed).
 */
export function planReminders(due: ReminderKind[], alreadySent: ReminderKind[]) {
  return {
    send: due.filter((k) => !alreadySent.includes(k)),
    rearm: alreadySent.filter((k) => !due.includes(k)),
  };
}

export function reminderText(kinds: ReminderKind[], check: ReminderCheck, locale: string, appName: string) {
  const en = locale === 'en';
  const days = kinds.includes('days');
  const data = kinds.includes('data');
  const d = check.daysLeft ?? 0;
  const pct = Math.round((check.dataLeft ?? 0) * 100);
  const daysPart = en
    ? d <= 0 ? 'has expired' : `expires in ${d} day${d === 1 ? '' : 's'}`
    : d <= 0 ? 'منقضی شده است' : `${toFaDigits(d)} روز دیگر تمام می‌شود`;
  const dataPart = en
    ? pct <= 0 ? 'has no data left' : `has ${pct}% of its data left`
    : pct <= 0 ? 'حجمش تمام شده است' : `فقط ${toFaDigits(pct)}٪ از حجمش باقی مانده`;

  if (en) {
    const title = days && d <= 0 ? 'Your subscription has expired' : days ? 'Your subscription ends soon' : 'You are running out of data';
    const parts = [days && daysPart, data && dataPart].filter(Boolean).join(' and ');
    return { title, body: `Your ${appName} subscription ${parts}. Renew to stay connected.` };
  }
  const title = days && d <= 0 ? 'اشتراک شما منقضی شد' : days ? 'اشتراک شما رو به پایان است' : 'حجم اشتراک رو به پایان است';
  const parts = [days && daysPart, data && dataPart].filter(Boolean).join(' و ');
  return { title, body: `اشتراک ${appName} شما ${parts}. برای قطع نشدن، تمدید کنید.` };
}

function toFaDigits(n: number) {
  return String(n).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]);
}
