'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { relativeTime } from '@/lib/format';
import { PushLog, adminApi } from './adminApi';
import { Card, errMsg } from './ui';

const fa = (n: number) => n.toLocaleString('fa-IR');

const KINDS: Array<{ id: PushLog['kind'] | 'all'; label: string }> = [
  { id: 'all', label: 'همه' },
  { id: 'reminder', label: 'یادآوری' },
  { id: 'renewal', label: 'تمدید و خرید' },
  { id: 'broadcast', label: 'اطلاعیه' },
];

const KIND_LABEL: Record<PushLog['kind'], string> = {
  reminder: 'یادآوری',
  renewal: 'تمدید و خرید',
  broadcast: 'اطلاعیه',
  test: 'آزمایشی کاربر',
  other: 'سایر',
};

/** Every push the system sent for this brand, and how far each one got. */
export function PushLogCard({ brandId, version }: { brandId: string; version: number }) {
  const [rows, setRows] = useState<PushLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<PushLog['kind'] | 'all'>('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminApi.pushLogs(brandId));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, version]);

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    const recent = (rows ?? []).filter((r) => Date.parse(r.createdAt) >= since);
    const sum = (k: 'total' | 'sent' | 'delivered' | 'opened' | 'failed') => recent.reduce((n, r) => n + r[k], 0);
    return { count: recent.length, total: sum('total'), sent: sum('sent'), delivered: sum('delivered'), opened: sum('opened'), failed: sum('failed') };
  }, [rows]);

  const shown = (rows ?? []).filter((r) => kind === 'all' || r.kind === kind);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">اعلان‌های ارسال‌شده</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-[var(--ink-2)] disabled:opacity-50"
          aria-label="تازه‌سازی"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تازه‌سازی
        </button>
      </div>
      <p className="mt-1 text-xs leading-6 text-[var(--ink-3)]">
        «ارسال» یعنی سرویس اعلان گوگل/اپل آن را پذیرفت؛ «نمایش» یعنی گوشی کاربر واقعاً نشانش داد؛ «باز شد» یعنی روی آن زد.
        گوشی‌هایی که از این نسخه به بعد اپ را باز نکرده‌اند نمایش را گزارش نمی‌دهند.
      </p>

      {rows && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="ارسال در ۷ روز" value={fa(week.count)} />
          <Stat label="پذیرفته‌شده" value={week.total ? `${fa(week.sent)} از ${fa(week.total)}` : '—'} />
          <Stat label="نمایش روی گوشی" value={week.sent ? `${fa(Math.round((week.delivered / week.sent) * 100))}٪` : '—'} />
          <Stat label="باز شده" value={fa(week.opened)} warn={week.failed > 0 ? `${fa(week.failed)} خطا` : undefined} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="tab"
            aria-selected={kind === k.id}
            onClick={() => setKind(k.id)}
            className={`rounded-full px-3 py-1 text-xs ${kind === k.id ? 'bg-[var(--ink)] text-[var(--surface)]' : 'bg-[var(--surface-2)] text-[var(--ink-2)]'}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[#d4373f]">{error}</p>}
      {rows && !shown.length && <p className="mt-4 text-sm text-[var(--ink-3)]">هنوز اعلانی ارسال نشده.</p>}

      <ul className="mt-3 divide-y divide-[var(--line)]">
        {shown.map((r) => (
          <li key={r.id} className="py-3">
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-3)]">
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5">{KIND_LABEL[r.kind] ?? r.kind}</span>
              <time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString('fa-IR')}>
                {relativeTime(r.createdAt, 'fa')}
              </time>
            </div>
            <p className="mt-1.5 text-sm font-medium">{r.title}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-[var(--ink-2)]">{r.body}</p>
            <Outcome r={r} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
      <p className="text-[11px] text-[var(--ink-3)]">{label}</p>
      <p className="mt-0.5 text-sm font-medium">
        {value}
        {warn && <span className="ms-1.5 text-[11px] font-normal text-[#d4373f]">{warn}</span>}
      </p>
    </div>
  );
}

function Outcome({ r }: { r: PushLog }) {
  if (!r.total) {
    return (
      <p className="mt-1.5 text-xs text-[#b7791f]">
        به هیچ دستگاهی نرفت — {r.subId ? 'کاربر این اشتراک' : 'هیچ کاربری'} اعلان را روشن نکرده است.
      </p>
    );
  }
  const parts = [
    `${fa(r.total)} دستگاه`,
    `${fa(r.sent)} ارسال`,
    `${fa(r.delivered)} نمایش`,
    `${fa(r.opened)} باز شد`,
  ];
  return (
    <div className="mt-1.5 text-xs">
      <p className={r.sent ? 'text-[#1fa66a]' : 'text-[#d4373f]'}>{parts.join(' · ')}</p>
      {(r.expired > 0 || r.failed > 0) && (
        <p className="mt-0.5 text-[var(--ink-3)]">
          {r.expired > 0 && `${fa(r.expired)} دستگاه اعلان را خاموش کرده بود و حذف شد. `}
          {r.failed > 0 && <span className="text-[#d4373f]">{fa(r.failed)} خطا{r.error ? `: ${r.error}` : ''}</span>}
        </p>
      )}
    </div>
  );
}
