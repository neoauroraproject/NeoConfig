'use client';

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { RenewalPlan } from '@/lib/api';
import { Button, Card } from './ui';

const MAX_PLANS = 12;
const DAY_CHIPS = [30, 60, 90, 180, 365];
const USER_CHOICES = [
  { v: 0, label: 'بدون تغییر' },
  { v: 1, label: '۱' },
  { v: 2, label: '۲' },
  { v: 3, label: '۳' },
  { v: 4, label: '۴' },
  { v: 5, label: '۵' },
];

const TEMPLATES: Array<Omit<RenewalPlan, 'id' | 'title' | 'price'>> = [
  { days: 30, gb: 30, users: 1, mode: 'add' },
  { days: 30, gb: 50, users: 2, mode: 'add' },
  { days: 90, gb: 150, users: 2, mode: 'add' },
  { days: 30, gb: 0, users: 1, mode: 'reset' },
  { days: 0, gb: 20, users: 0, mode: 'add' },
];

const fa = (n: number) => n.toLocaleString('fa-IR');

function periodLabel(days: number) {
  const named: Record<number, string> = { 30: 'یک‌ماهه', 60: 'دوماهه', 90: 'سه‌ماهه', 180: 'شش‌ماهه', 365: 'یک‌ساله' };
  return named[days] ?? `${fa(days)} روزه`;
}

/** A readable default title, e.g. «یک‌ماهه ۵۰ گیگ دوکاربره». */
export function planTitle(p: Pick<RenewalPlan, 'days' | 'gb' | 'users' | 'mode'>) {
  const parts: string[] = [];
  if (p.days > 0) parts.push(periodLabel(p.days));
  if (p.mode === 'reset' && p.gb <= 0) parts.push('نامحدود');
  else if (p.gb > 0) parts.push(p.days > 0 ? `${fa(p.gb)} گیگ` : `${fa(p.gb)} گیگ حجم اضافه`);
  if (p.users === 1) parts.push('تک‌کاربره');
  else if (p.users === 2) parts.push('دوکاربره');
  else if (p.users > 2) parts.push(`${fa(p.users)} کاربره`);
  return parts.join(' ') || 'پلن جدید';
}

/** What the customer reads under the title in the app. */
function summary(p: RenewalPlan) {
  const parts: string[] = [];
  if (p.days > 0) parts.push(`+${fa(p.days)} روز`);
  if (p.mode === 'reset') parts.push(p.gb > 0 ? `${fa(p.gb)} گیگ` : 'نامحدود');
  else if (p.gb > 0) parts.push(`+${fa(p.gb)} گیگ`);
  if (p.users === 1) parts.push('تک‌کاربره');
  else if (p.users > 1) parts.push(`${fa(p.users)} کاربره`);
  return parts.join(' · ');
}

const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const priceDigits = (price: string) => toLatin(price).replace(/\D/g, '');
const formatPrice = (digits: string) => (digits ? `${fa(Number(digits))} تومان` : '');

function problems(p: RenewalPlan) {
  const out: string[] = [];
  if (!p.title.trim()) out.push('عنوان');
  if (!p.price.trim()) out.push('قیمت');
  if (p.days <= 0 && p.gb <= 0 && p.mode === 'add') out.push('روز یا گیگ');
  return out;
}

export function PlansEditor({ plans, onChange }: { plans: RenewalPlan[]; onChange: (plans: RenewalPlan[]) => void }) {
  const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  /** Keep auto titles in sync with the numbers until the admin types their own. */
  const update = (i: number, patch: Partial<RenewalPlan>) =>
    onChange(
      plans.map((p, j) => {
        if (j !== i) return p;
        const next = { ...p, ...patch };
        const auto = !p.title.trim() || p.title === planTitle(p);
        return 'title' in patch || !auto ? next : { ...next, title: planTitle(next) };
      }),
    );
  const add = (t: Omit<RenewalPlan, 'id' | 'title' | 'price'>) =>
    onChange([...plans, { ...t, id: newId(), title: planTitle(t), price: '' }]);
  const move = (i: number, d: -1 | 1) => {
    const next = [...plans];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const full = plans.length >= MAX_PLANS;
  const categories = [...new Set(plans.map((p) => p.category).filter((c): c is string => Boolean(c)))];

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          پلن‌ها <span className="text-xs font-normal text-[var(--ink-3)]">({fa(plans.length)} از {fa(MAX_PLANS)})</span>
        </h2>
        <Button variant="secondary" onClick={() => add({ days: 30, gb: 50, users: 1, mode: 'add' })} disabled={full}>
          <Plus className="h-4 w-4" /> پلن خالی
        </Button>
      </div>
      <datalist id="plan-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="mb-2 text-xs text-[var(--ink-3)]">شروع سریع — یکی را بزن، بعد فقط قیمت بگذار:</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={planTitle(t)}
            type="button"
            disabled={full}
            onClick={() => add(t)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-xs hover:border-[var(--ink-3)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {planTitle(t)}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {plans.map((p, i) => {
          const issues = problems(p);
          return (
            <section key={p.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-3 sm:p-4" aria-label={p.title || `پلن ${fa(i + 1)}`}>
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--ink)] text-xs text-white">{fa(i + 1)}</span>
                <input
                  aria-label="عنوان پلن"
                  className="field flex-1 !bg-[var(--surface)] font-medium"
                  value={p.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder={planTitle(p)}
                />
                <div className="flex shrink-0 items-center">
                  <IconBtn label="بالا" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn label="پایین" disabled={i === plans.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn label="کپی" disabled={full} onClick={() => onChange([...plans.slice(0, i + 1), { ...p, id: newId() }, ...plans.slice(i + 1)])}>
                    <Copy className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn label={`حذف ${p.title}`} onClick={() => onChange(plans.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </IconBtn>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {/* time */}
                <div>
                  <p className="mb-1.5 text-xs text-[var(--ink-2)]">زمان</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {DAY_CHIPS.map((d) => (
                      <Chip key={d} on={p.days === d} onClick={() => update(i, { days: d })}>
                        {periodLabel(d)}
                      </Chip>
                    ))}
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
                      <input
                        type="number"
                        min={0}
                        dir="ltr"
                        aria-label="تعداد روز"
                        className="field !h-9 !w-20 !py-1 text-center"
                        value={p.days || ''}
                        placeholder="0"
                        onChange={(e) => update(i, { days: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                      />
                      روز
                    </label>
                  </div>
                </div>

                {/* data */}
                <div>
                  <p className="mb-1.5 text-xs text-[var(--ink-2)]">حجم</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        dir="ltr"
                        aria-label="گیگ"
                        className="field !h-9 !w-24 !py-1 text-center"
                        value={p.gb || ''}
                        placeholder="0"
                        onChange={(e) => update(i, { gb: Math.max(0, Number(e.target.value) || 0) })}
                      />
                      گیگ
                    </label>
                    {p.mode === 'reset' && (
                      <Chip on={p.gb <= 0} onClick={() => update(i, { gb: 0 })}>
                        نامحدود
                      </Chip>
                    )}
                  </div>
                </div>

                {/* mode */}
                <div>
                  <p className="mb-1.5 text-xs text-[var(--ink-2)]">نوع تمدید</p>
                  <div className="inline-flex rounded-full bg-[var(--surface)] p-1" role="radiogroup" aria-label="نوع تمدید">
                    {(
                      [
                        ['add', 'افزودن به سرویس'],
                        ['reset', 'دورهٔ جدید'],
                      ] as const
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={(p.mode ?? 'add') === m}
                        onClick={() => update(i, { mode: m })}
                        className={`h-8 rounded-full px-3 text-xs ${(p.mode ?? 'add') === m ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-3)]">
                    {p.mode === 'reset'
                      ? 'حجم روی همین مقدار تنظیم و مصرف صفر می‌شود؛ روزها به انقضا اضافه می‌شوند.'
                      : 'روز و گیگ روی باقی‌ماندهٔ فعلی اضافه می‌شود و مصرف دست نمی‌خورد.'}
                  </p>
                </div>

                {/* users */}
                <div>
                  <p className="mb-1.5 text-xs text-[var(--ink-2)]">کاربر مجاز (تعداد دستگاه / HWID)</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="کاربر مجاز">
                    {USER_CHOICES.map((u) => (
                      <Chip key={u.v} on={(p.users ?? 0) === u.v} onClick={() => update(i, { users: u.v })} role="radio">
                        {u.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                {/* service kind */}
                <div>
                  <p className="mb-1.5 text-xs text-[var(--ink-2)]">برای کدام سرویس</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="نوع سرویس">
                    {(
                      [
                        [undefined, 'همه'],
                        ['xui', 'ثنایی (3x-ui)'],
                        ['pasarguard', 'پاسارگارد'],
                      ] as const
                    ).map(([v, label]) => (
                      <Chip key={label} on={p.service === v} onClick={() => update(i, { service: v })} role="radio">
                        {label}
                      </Chip>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-5 text-[var(--ink-3)]">کاربر فقط پلن‌های نوع سرویس خودش را می‌بیند.</p>
                </div>

                {/* category */}
                <label className="block">
                  <span className="mb-1.5 block text-xs text-[var(--ink-2)]">دسته‌بندی (اختیاری)</span>
                  <input
                    className="field !bg-[var(--surface)]"
                    list="plan-categories"
                    maxLength={40}
                    value={p.category ?? ''}
                    placeholder="مثلاً: آلمان، اقتصادی، ویژه"
                    onChange={(e) => update(i, { category: e.target.value || undefined })}
                  />
                </label>
              </div>

              {/* price + preview */}
              <div className="mt-3 grid gap-3 lg:grid-cols-2 lg:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-[var(--ink-2)]">قیمت (تومان)</span>
                  <input
                    inputMode="numeric"
                    dir="ltr"
                    className="field num !bg-[var(--surface)] text-left"
                    value={priceDigits(p.price) ? Number(priceDigits(p.price)).toLocaleString('en-US') : ''}
                    placeholder="150,000"
                    onChange={(e) => update(i, { price: formatPrice(priceDigits(e.target.value).slice(0, 12)) })}
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-xs text-[var(--ink-2)]">در اپ کاربر</span>
                  <div className="flex items-center gap-3 rounded-2xl bg-[var(--ink)] px-4 py-3 text-white">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.title || planTitle(p)}</span>
                      <span className="block text-[11px] opacity-70">{summary(p) || '—'}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{p.price || '—'}</span>
                  </div>
                </div>
              </div>

              {issues.length > 0 && (
                <p className="mt-2 text-xs text-[#b4541a]" role="status">
                  کامل نیست — {issues.join('، ')} را وارد کن؛ پلن ناقص در اپ نمایش داده نمی‌شود.
                </p>
              )}
            </section>
          );
        })}
        {plans.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--ink-3)]">
            هنوز پلنی نساخته‌ای. از «شروع سریع» یکی را انتخاب کن.
          </p>
        )}
      </div>
    </Card>
  );
}

function Chip({ on, onClick, children, role }: { on: boolean; onClick: () => void; children: React.ReactNode; role?: string }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? on : undefined}
      aria-pressed={role ? undefined : on}
      onClick={onClick}
      className={`h-9 rounded-full px-3 text-xs ${on ? 'bg-[var(--ink)] text-white' : 'border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]'}`}
    >
      {children}
    </button>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-[var(--ink-2)] hover:bg-[var(--surface)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}
