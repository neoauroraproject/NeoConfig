'use client';

import { ChevronDown } from 'lucide-react';
import type { AdminBrand, ReminderSettings } from './adminApi';
import { Card, Toggle } from './ui';

type SetFn = <K extends keyof AdminBrand>(k: K, v: AdminBrand[K]) => void;
type Key = keyof ReminderSettings['texts'];

const MESSAGES: Array<{ key: Key; label: string; vars: string }> = [
  { key: 'days', label: 'رو به پایان (چند روز مانده)', vars: '{name} {days} {app}' },
  { key: 'lastDay', label: 'روز آخر', vars: '{name} {app}' },
  { key: 'expired', label: 'منقضی شد', vars: '{name} {app}' },
  { key: 'data', label: 'حجم رو به پایان', vars: '{name} {percent} {app}' },
  { key: 'dataOut', label: 'حجم تمام شد', vars: '{name} {app}' },
  { key: 'approved', label: 'تمدید تأیید شد', vars: '{plan} {name} {app}' },
  { key: 'rejected', label: 'تمدید رد شد', vars: '{reason} {plan} {name} {app}' },
];

/** The brand's automatic notifications: which ones, when, and in what words. */
export function RemindersCard({ draft, set }: { draft: AdminBrand; set: SetFn }) {
  const r = draft.reminders;
  const update = (patch: Partial<ReminderSettings>) => set('reminders', { ...r, ...patch });
  const text = (key: Key, field: 'title' | 'body', value: string) =>
    update({ texts: { ...r.texts, [key]: { ...r.texts[key], [field]: value } } });

  return (
    <Card>
      <Toggle
        id="n-remind"
        label="یادآوری خودکار پیش از پایان اشتراک و حجم"
        checked={draft.expiryRemindersEnabled}
        onChange={(v) => set('expiryRemindersEnabled', v)}
      />
      <p className="mt-1 text-xs leading-6 text-[var(--ink-3)]">
        هر ۳۰ دقیقه بررسی می‌شود و هر اعلان یک بار می‌رود (بعد از تمدید دوباره فعال می‌شود)؛ حتی وقتی اپ بسته است.
      </p>

      {draft.expiryRemindersEnabled && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm">
            <span>هشدار چند روز قبل از پایان</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={30}
                dir="ltr"
                className="field !h-9 !w-16 !py-1 text-center"
                value={r.days}
                onChange={(e) => update({ days: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
              />
              روز
            </span>
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm">
            <span>هشدار وقتی حجم کمتر از</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={90}
                dir="ltr"
                className="field !h-9 !w-16 !py-1 text-center"
                value={r.dataPercent}
                onChange={(e) => update({ dataPercent: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
              />
              ٪ مانده
            </span>
          </label>
          <div className="rounded-xl bg-[var(--surface-2)] px-3 py-1">
            <Toggle id="n-lastday" label="یادآوری روز آخر" checked={r.lastDay} onChange={(v) => update({ lastDay: v })} />
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-3 py-1">
            <Toggle id="n-expired" label="اعلان منقضی شدن" checked={r.expired} onChange={(v) => update({ expired: v })} />
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-3 py-1 sm:col-span-2">
            <Toggle id="n-dataout" label="اعلان تمام شدن حجم" checked={r.dataOut} onChange={(v) => update({ dataOut: v })} />
          </div>
          <p className="text-[11px] text-[var(--ink-3)] sm:col-span-2">عدد ۰ یعنی آن هشدار خاموش است.</p>
        </div>
      )}

      <h3 className="mb-2 mt-5 text-[13px] font-medium text-[var(--ink-2)]">متن اعلان‌ها</h3>
      <div className="space-y-2">
        {MESSAGES.map((m) => (
          <details key={m.key} className="group rounded-xl border border-[var(--line)] open:bg-[var(--surface-2)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
              <span className="flex-1">{m.label}</span>
              <span className="max-w-[45%] truncate text-xs text-[var(--ink-3)]">{r.texts[m.key].title}</span>
              <ChevronDown className="h-4 w-4 text-[var(--ink-3)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-2 px-3 pb-3">
              <input className="field" maxLength={80} value={r.texts[m.key].title} onChange={(e) => text(m.key, 'title', e.target.value)} aria-label="عنوان" />
              <textarea
                className="field min-h-[4rem] resize-y"
                rows={2}
                maxLength={240}
                value={r.texts[m.key].body}
                onChange={(e) => text(m.key, 'body', e.target.value)}
                aria-label="متن"
              />
              <p className="text-[11px] text-[var(--ink-3)]" dir="ltr">
                {m.vars}
              </p>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}
