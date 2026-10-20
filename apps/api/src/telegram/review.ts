import type { NormalizedSubscription } from '../integrations/xui/types';
import { nextExpiryMs, nextQuotaBytes, normalizeTerms } from '../panels/renewal-terms';

const GB = 1024 ** 3;

export interface RenewalNotice {
  id: string;
  displayName: string | null;
  subId: string;
  planTitle: string;
  price: string;
  days: number;
  gb: number;
  users?: number;
  mode?: string;
  payerName: string | null;
  payerNote: string | null;
  createdAt?: Date;
  review?: ReviewInfo;
}

/** What the bot checks before a human looks at the receipt. */
export interface ReviewInfo {
  /** Where the account lives. */
  panel?: { name: string; type: string } | null;
  /** The account as the panel reports it right now (null when it could not be read). */
  current?: Pick<
    NormalizedSubscription,
    'status' | 'quotaKind' | 'quotaBytes' | 'totalUsedBytes' | 'remainingBytes' | 'expiryKind' | 'expiryAt'
  > | null;
  /** Another request in this brand carried the exact same image. */
  duplicateOf?: { id: string; createdAt: Date; status: string; displayName: string | null } | null;
  approvedBefore?: number;
  lastApprovedAt?: Date | null;
  pendingCount?: number;
  /** The account was matched on a panel, so approval renews it automatically. */
  canApply?: boolean;
  /** HMPanel's store refused the order, so it is reviewed here instead; its own words. */
  storeRefused?: string | null;
}

/** Inline-button reasons; the text is what the customer sees in their app. */
export const REJECT_REASONS = {
  x1: { button: 'مبلغ اشتباه', note: 'مبلغ واریزی با پلن انتخاب‌شده مطابقت ندارد.' },
  x2: { button: 'رسید نامعتبر', note: 'رسید نامعتبر است یا خوانا نیست. لطفاً تصویر واضح رسید را دوباره بفرستید.' },
  x3: { button: 'تکراری', note: 'این رسید قبلاً ثبت شده است.' },
} as const;
type ReasonKey = keyof typeof REJECT_REASONS;

export type CallbackAction =
  | { kind: 'approve'; id: string }
  | { kind: 'manual'; id: string }
  | { kind: 'reject'; id: string; note?: string };

/** callback_data: nc:a:<id> approve · nc:m:<id> approve without panel · nc:r:<id> reject · nc:x1..x3:<id> reject with reason */
export function parseCallback(data: string | undefined): CallbackAction | null {
  const m = /^nc:(a|m|r|x[1-3]):([a-z0-9]{10,40})$/.exec(data || '');
  if (!m) return null;
  const [, k, id] = m;
  if (k === 'a') return { kind: 'approve', id };
  if (k === 'm') return { kind: 'manual', id };
  if (k === 'r') return { kind: 'reject', id };
  return { kind: 'reject', id, note: REJECT_REASONS[k as ReasonKey].note };
}

export type Markup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/**
 * Two ways to approve: auto renews on the panel now; manual only confirms the
 * payment and the admin renews by hand. After a panel refusal (`manual`), auto is dropped.
 */
export function reviewKeyboard(id: string, opts: { manual?: boolean } = {}): Markup {
  const reasons = (Object.keys(REJECT_REASONS) as ReasonKey[]).map((k) => ({
    text: `✖️ ${REJECT_REASONS[k].button}`,
    callback_data: `nc:${k}:${id}`,
  }));
  const approve = opts.manual
    ? [{ text: '☑️ تأیید، تمدید دستی', callback_data: `nc:m:${id}` }]
    : [
        { text: '✅ تأیید + تمدید خودکار', callback_data: `nc:a:${id}` },
        { text: '☑️ تأیید، تمدید دستی', callback_data: `nc:m:${id}` },
      ];
  return {
    inline_keyboard: [approve, [{ text: '❌ رد', callback_data: `nc:r:${id}` }, ...reasons]],
  };
}

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PANEL_LABEL: Record<string, string> = { xui: 'ثنایی (3x-ui)', pasarguard: 'پاسارگارد', hmpanel: 'HMPanel' };
const faDateTime = (d: Date | number) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(d);
const faDate = (d: Date | number) => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(d);
const gbText = (bytes: number) => `${+(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} گیگ`;

function termsLine(r: RenewalNotice) {
  const users = r.users ? ` · ${r.users === 1 ? 'تک‌کاربره' : `${r.users} کاربره`}` : '';
  const volume =
    r.mode === 'reset' ? (r.gb > 0 ? `${r.gb} گیگ (مصرف صفر می‌شود)` : 'نامحدود') : r.gb > 0 ? `+${r.gb} گیگ` : 'بدون حجم اضافه';
  return `${r.days > 0 ? `+${r.days} روز` : 'بدون تغییر زمان'} · ${volume}${users}`;
}

function nowLine(c: NonNullable<ReviewInfo['current']>) {
  const vol =
    c.quotaKind === 'unlimited'
      ? 'نامحدود'
      : c.quotaKind === 'known' && c.remainingBytes !== null
        ? `${gbText(Math.max(0, c.remainingBytes))} مانده`
        : 'حجم نامشخص';
  const exp =
    c.expiryKind === 'none'
      ? 'بدون انقضا'
      : c.expiryKind === 'known' && c.expiryAt
        ? new Date(c.expiryAt).getTime() < Date.now()
          ? `منقضی ${faDate(new Date(c.expiryAt))}`
          : `تا ${faDate(new Date(c.expiryAt))}`
        : 'انقضا نامشخص';
  return `${vol} · ${exp}`;
}

function afterLine(r: RenewalNotice, c: NonNullable<ReviewInfo['current']>) {
  const terms = normalizeTerms({ days: r.days, gb: r.gb, users: r.users, mode: r.mode as 'add' | 'reset' });
  const quotaNow = c.quotaKind === 'known' ? c.quotaBytes ?? 0 : 0;
  const quota = nextQuotaBytes(quotaNow, terms, c.totalUsedBytes ?? 0);
  const used = terms.mode === 'reset' ? 0 : c.totalUsedBytes ?? 0;
  const vol = quota <= 0 ? 'نامحدود' : `${gbText(Math.max(0, quota - used))} مانده`;
  const expMs = c.expiryKind === 'known' && c.expiryAt ? new Date(c.expiryAt).getTime() : 0;
  const nextMs = nextExpiryMs(expMs, terms.days);
  const exp = nextMs > 0 ? `تا ${faDate(nextMs)}` : 'بدون انقضا';
  return `${vol} · ${exp}`;
}

/** The receipt caption: what was bought, the account now and after, and the automatic checks. */
export function receiptCaption(appName: string, r: RenewalNotice): string {
  const v = r.review;
  const lines: Array<string | null> = [
    `🧾 <b>رسید تمدید</b> · ${esc(appName)}`,
    '',
    `👤 <b>${esc(r.displayName || r.subId)}</b>`,
    v?.panel ? `🖥 ${esc(v.panel.name)} · ${PANEL_LABEL[v.panel.type] ?? v.panel.type}` : null,
    r.subId && !r.subId.startsWith('new:') ? `🔑 <code>${esc(r.subId.slice(0, 64))}</code>` : null,
    `📦 ${esc(r.planTitle)} — <b>${esc(r.price)}</b>`,
    `⏱ ${termsLine(r)}`,
    r.createdAt ? `🕒 ${faDateTime(r.createdAt)} · #${r.id.slice(-6)}` : null,
    r.payerName ? `💳 واریزکننده: ${esc(r.payerName)}` : null,
    r.payerNote ? `📝 ${esc(r.payerNote)}` : null,
  ];
  if (v?.current) {
    lines.push('', `📊 الان: ${nowLine(v.current)}`, `➡️ بعد از تأیید: ${afterLine(r, v.current)}`);
  }
  if (v) {
    const checks: string[] = [];
    if (v.duplicateOf) {
      const who = v.duplicateOf.displayName ? ` (${esc(v.duplicateOf.displayName)})` : '';
      checks.push(`⚠️ <b>رسید تکراری</b> — همین تصویر ${faDate(v.duplicateOf.createdAt)}${who} فرستاده شده`);
    } else {
      checks.push('✅ تصویر رسید تکراری نیست');
    }
    if (v.canApply === false) checks.push('⚠️ اکانت روی پنل پیدا نشد؛ «تمدید خودکار» دوباره جست‌وجو می‌کند، وگرنه دستی تمدید کنید');
    else if (v.canApply) checks.push('✅ اکانت روی پنل پیدا شد؛ تمدید خودکار آماده است');
    if (v.storeRefused) checks.push(`⚠️ فروشگاه HMPanel این تمدید را نپذیرفت: <i>${esc(v.storeRefused.slice(0, 160))}</i> — برای همین اینجا آمد`);
    if (v.pendingCount && v.pendingCount > 1) checks.push(`⚠️ ${v.pendingCount} درخواست باز برای این اشتراک`);
    if (v.approvedBefore) {
      const last = v.lastApprovedAt ? ` · آخرین: ${faDate(v.lastApprovedAt)}` : '';
      checks.push(`🔁 ${v.approvedBefore} تمدید قبلی${last}`);
    } else {
      checks.push('🆕 اولین تمدید این اشتراک');
    }
    lines.push('', '🔎 <b>بررسی خودکار</b>', ...checks);
  }
  return fit(lines.filter((l): l is string => l !== null), 1024);
}

/** Telegram photo captions stop at 1024 characters; drop whole lines from the end of the notes first. */
function fit(lines: string[], max: number) {
  let text = lines.join('\n');
  const optional = lines.findIndex((l) => l.startsWith('📝'));
  if (text.length > max && optional >= 0) {
    lines = [...lines.slice(0, optional), ...lines.slice(optional + 1)];
    text = lines.join('\n');
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function decisionLine(d: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null }) {
  const note = d.note ? `\n📝 ${esc(d.note)}` : '';
  if (!d.approved) return `❌ <b>رد شد</b> توسط ${esc(d.by)}${note}`;
  const applied =
    d.appliedOnPanel === null ? ' — تمدید دستی توسط ادمین' : d.appliedOnPanel ? ' — روی پنل خودکار تمدید شد' : ' — روی پنل اعمال نشد، دستی تمدید کنید';
  return `✅ <b>تأیید شد</b> توسط ${esc(d.by)}${applied}${note}`;
}

export const HELP_TEXT = [
  '🤖 <b>ربات تمدید</b>',
  '',
  'رسیدها با دکمهٔ تأیید/رد اینجا می‌آیند. تأیید، اشتراک را روی پنل تمدید می‌کند و به کاربر اعلان می‌دهد.',
  '',
  '/pending — درخواست‌های در انتظار (دوباره با رسید)',
  '/stats — آمار امروز و این ماه',
  '/help — همین راهنما',
].join('\n');
