import type { ReminderCheck, ReminderKind } from './reminder-rules';

/** A brand's own rules and wording for the automatic notifications. */
export interface ReminderSettings {
  /** «Ending soon» this many days before expiry (0 = off). */
  days: number;
  /** A second nudge on the last day. */
  lastDay: boolean;
  /** Tell them when it has expired. */
  expired: boolean;
  /** «Running low» at this share of data left, in percent (0 = off). */
  dataPercent: number;
  /** Tell them when the data is used up. */
  dataOut: boolean;
  /** Message per notification; {app} {name} {days} {percent} {plan} {reason} are filled in. */
  texts: Record<MessageKey, { title: string; body: string }>;
}

export type MessageKey = 'days' | 'lastDay' | 'expired' | 'data' | 'dataOut' | 'approved' | 'rejected';

export const DEFAULT_TEXTS: ReminderSettings['texts'] = {
  days: { title: 'اشتراک شما رو به پایان است', body: 'اشتراک {name} فقط {days} روز دیگر اعتبار دارد. برای قطع نشدن، تمدید کنید.' },
  lastDay: { title: 'امروز آخرین روز اشتراک است', body: 'اشتراک {name} امروز تمام می‌شود. همین حالا تمدید کنید.' },
  expired: { title: 'اشتراک شما منقضی شد', body: 'اشتراک {name} منقضی شده است. برای وصل شدن دوباره، تمدید کنید.' },
  data: { title: 'حجم اشتراک رو به پایان است', body: 'فقط {percent}٪ از حجم {name} باقی مانده. برای قطع نشدن، تمدید کنید.' },
  dataOut: { title: 'حجم اشتراک تمام شد', body: 'حجم {name} تمام شده است. با تمدید، دوباره وصل شوید.' },
  approved: { title: 'تمدید انجام شد', body: '{plan} روی اشتراک شما فعال شد.' },
  rejected: { title: 'درخواست تمدید تأیید نشد', body: '{reason}' },
};

export const DEFAULT_TEXTS_EN: ReminderSettings['texts'] = {
  days: { title: 'Your subscription ends soon', body: 'Your {app} subscription {name} expires in {days} days. Renew to stay connected.' },
  lastDay: { title: 'Last day of your subscription', body: 'Your {app} subscription {name} ends today. Renew now.' },
  expired: { title: 'Your subscription has expired', body: 'Your {app} subscription {name} has expired. Renew to reconnect.' },
  data: { title: 'You are running out of data', body: 'Your {app} subscription {name} has {percent}% of its data left. Renew to stay connected.' },
  dataOut: { title: 'Your data is used up', body: 'Your {app} subscription {name} has no data left. Renew to reconnect.' },
  approved: { title: 'Renewed', body: '{plan} is now active on your subscription.' },
  rejected: { title: 'Renewal not confirmed', body: '{reason}' },
};

export const DEFAULT_REMINDERS: ReminderSettings = {
  days: 3,
  lastDay: true,
  expired: true,
  dataPercent: 10,
  dataOut: true,
  texts: DEFAULT_TEXTS,
};

const KEYS = Object.keys(DEFAULT_TEXTS) as MessageKey[];

export function parseReminderSettings(json: string | null | undefined, locale = 'fa'): ReminderSettings {
  const defaults = locale === 'en' ? DEFAULT_TEXTS_EN : DEFAULT_TEXTS;
  let raw: Partial<ReminderSettings> & { texts?: Partial<Record<MessageKey, { title?: string; body?: string }>> } = {};
  try {
    raw = JSON.parse(json || '{}');
  } catch {
    raw = {};
  }
  const num = (v: unknown, def: number, max: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const texts = {} as ReminderSettings['texts'];
  for (const k of KEYS) {
    const t = raw.texts?.[k];
    texts[k] = {
      title: typeof t?.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 80) : defaults[k].title,
      body: typeof t?.body === 'string' && t.body.trim() ? t.body.trim().slice(0, 240) : defaults[k].body,
    };
  }
  return {
    days: num(raw.days, DEFAULT_REMINDERS.days, 30),
    lastDay: bool(raw.lastDay, true),
    expired: bool(raw.expired, true),
    dataPercent: num(raw.dataPercent, DEFAULT_REMINDERS.dataPercent, 90),
    dataOut: bool(raw.dataOut, true),
    texts,
  };
}

/** Only what differs from the defaults is stored, so later default improvements still reach brands. */
export function compactReminderSettings(input: unknown, locale = 'fa'): string {
  const defaults = locale === 'en' ? DEFAULT_TEXTS_EN : DEFAULT_TEXTS;
  const s = parseReminderSettings(JSON.stringify(input ?? {}), locale);
  const out: Record<string, unknown> = {};
  for (const k of ['days', 'lastDay', 'expired', 'dataPercent', 'dataOut'] as const) if (s[k] !== DEFAULT_REMINDERS[k]) out[k] = s[k];
  const texts: Record<string, unknown> = {};
  for (const k of KEYS) {
    const t: Record<string, string> = {};
    if (s.texts[k].title !== defaults[k].title) t.title = s.texts[k].title;
    if (s.texts[k].body !== defaults[k].body) t.body = s.texts[k].body;
    if (Object.keys(t).length) texts[k] = t;
  }
  if (Object.keys(texts).length) out.texts = texts;
  return JSON.stringify(out);
}

const faDigits = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

export function fill(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    if (v === null || v === undefined || v === '') return '';
    return typeof v === 'number' ? faDigits(v) : String(v);
  }).replace(/\s{2,}/g, ' ').trim();
}

/** The one push for whatever was just crossed; the most urgent threshold speaks. */
export function reminderMessage(
  kinds: ReminderKind[],
  check: ReminderCheck,
  settings: ReminderSettings,
  vars: { app: string; name: string },
) {
  const order: Array<[ReminderKind, MessageKey]> = [
    ['expired', 'expired'],
    ['data_out', 'dataOut'],
    ['days1', 'lastDay'],
    ['days', 'days'],
    ['data', 'data'],
  ];
  const key = order.find(([k]) => kinds.includes(k))?.[1] ?? 'days';
  const t = settings.texts[key];
  const values = { ...vars, days: check.daysLeft ?? 0, percent: Math.round((check.dataLeft ?? 0) * 100) };
  return { title: fill(t.title, values), body: fill(t.body, values) };
}
