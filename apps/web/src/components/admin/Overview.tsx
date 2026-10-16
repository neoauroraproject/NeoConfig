'use client';

import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/format';
import type { Section } from './AdminApp';
import { Overview, adminApi } from './adminApi';
import { Button, Card, PageHeader, StatusDot, errMsg } from './ui';

const STATUS_FA: Record<string, string> = { PENDING: 'در انتظار', APPROVED: 'تأیید شد', REJECTED: 'رد شد' };

export function OverviewPage({ go, isAdmin }: { go: (s: Section) => void; isAdmin: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.overview().then(setData).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <p className="text-sm text-[#d4373f]">{error}</p>;
  if (!data) return <OverviewSkeleton />;

  const max = Math.max(1, ...data.lookups14d.map((d) => d.found + d.missed));
  const foundTotal = data.lookups14d.reduce((n, d) => n + d.found, 0);
  const hitRate = data.lookupsTotal14d ? Math.round((foundTotal / data.lookupsTotal14d) * 100) : null;
  const unhealthy = data.panels.filter((p) => p.healthy === false);

  return (
    <div>
      <PageHeader title="داشبورد" subtitle="آنچه امروز به توجه نیاز دارد" />

      {data.pendingRenewals > 0 && (
        <button
          type="button"
          onClick={() => go('renewals')}
          className="mb-4 flex w-full items-center justify-between gap-4 rounded-2xl bg-[var(--ink)] px-5 py-4 text-start text-white"
        >
          <span>
            <span className="num text-2xl font-light">{data.pendingRenewals}</span>
            <span className="ms-3 text-sm">رسید تمدید منتظر بررسی است</span>
          </span>
          <span className="text-sm opacity-80">بررسی رسیدها</span>
        </button>
      )}
      {isAdmin && (data.panels.length === 0 || unhealthy.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f2c48d] bg-[#fff7ec] px-5 py-4">
          <p className="text-sm text-[#7a4a0b]">
            {data.panels.length === 0
              ? 'هنوز هیچ پنلی وصل نشده؛ تا وقتی پنل ثنایی یا پاسارگارد وصل نشود، اشتراک‌ها فقط از روی خود لینک خوانده می‌شوند.'
              : `اتصال ${unhealthy.map((p) => p.name).join('، ')} آخرین بار ناموفق بود.`}
          </p>
          <Button variant="secondary" onClick={() => go('panels')}>
            {data.panels.length === 0 ? 'افزودن پنل' : 'بررسی اتصال'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="تمدید در انتظار" value={data.pendingRenewals} />
        <Kpi label="تمدید تأییدشده این ماه" value={data.approvedThisMonth} />
        <Kpi label="استعلام ۱۴ روز اخیر" value={data.lookupsTotal14d} sub={hitRate !== null ? `${hitRate}٪ پیدا شد` : undefined} />
        <Kpi label="دستگاه با اعلان فعال" value={data.devices} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">استعلام‌های روزانه</h2>
            <p className="flex items-center gap-4 text-xs text-[var(--ink-2)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--ink)]" /> پیدا شد
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> پیدا نشد
              </span>
            </p>
          </div>
          <div className="mt-6 flex h-40 items-end gap-1.5" dir="ltr" role="img" aria-label="نمودار استعلام روزانه">
            {data.lookups14d.map((d) => {
              const total = d.found + d.missed;
              return (
                <div key={d.date} className="flex h-full flex-1 flex-col justify-end gap-[2px]" title={`${d.date}: ${d.found} / ${d.missed}`}>
                  {total === 0 ? (
                    <span className="h-1.5 rounded-full bg-[var(--line)]" />
                  ) : (
                    <>
                      {d.missed > 0 && <span className="rounded-md bg-[var(--accent)]" style={{ height: `${(d.missed / max) * 100}%` }} />}
                      {d.found > 0 && <span className="rounded-md bg-[var(--ink)]" style={{ height: `${(d.found / max) * 100}%` }} />}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-[var(--ink-3)]" dir="ltr">
            <span>{data.lookups14d[0]?.date.slice(5)}</span>
            <span>{data.lookups14d[data.lookups14d.length - 1]?.date.slice(5)}</span>
          </div>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">{isAdmin ? 'سلامت پنل‌ها' : 'برندهای شما'}</h2>
            <button type="button" onClick={() => go(isAdmin ? 'panels' : 'brands')} className="text-xs text-[var(--brand)]">
              مدیریت
            </button>
          </div>
          <ul className="mt-4 divide-y divide-[var(--line)]">
            {isAdmin
              ? data.panels.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <StatusDot ok={p.healthy} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block truncate text-xs text-[var(--ink-3)]">
                        {p.type === 'pasarguard' ? 'PasarGuard' : '3x-ui ثنایی'}
                        {p.lastTestAt ? ` · ${relativeTime(p.lastTestAt, 'fa')}` : ' · تست نشده'}
                      </span>
                    </span>
                  </li>
                ))
              : data.brands.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 py-3">
                    <span className="h-3 w-3 rounded-full" style={{ background: b.primaryColor }} />
                    <span className="flex-1 text-sm">{b.appName}</span>
                  </li>
                ))}
            {isAdmin && data.panels.length === 0 && <li className="py-3 text-sm text-[var(--ink-3)]">پنلی وصل نیست.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">آخرین درخواست‌های تمدید</h2>
          <button type="button" onClick={() => go('renewals')} className="text-xs text-[var(--brand)]">
            همه
          </button>
        </div>
        {data.recentRenewals.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-3)]">
            هنوز درخواستی نیامده. تمدید را در تنظیمات برند فعال کن تا کاربران بتوانند رسید بفرستند.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {data.recentRenewals.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.brand.primaryColor }} />
                <span className="min-w-0 flex-1 truncate">
                  {r.displayName || '—'} <span className="text-[var(--ink-3)]">· {r.planTitle}</span>
                </span>
                <span className="hidden text-[var(--ink-2)] sm:inline">{r.price}</span>
                <span className="w-20 text-end text-xs text-[var(--ink-2)]">{STATUS_FA[r.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="text-[13px] text-[var(--ink-2)]">{label}</p>
      <p className="num mt-3 text-3xl font-light">{value.toLocaleString('en-US')}</p>
      {sub && <p className="mt-1 text-xs text-[var(--ink-3)]">{sub}</p>}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-[var(--line)]" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-[var(--surface)]" />
        ))}
      </div>
      <div className="mt-3 h-64 rounded-2xl bg-[var(--surface)]" />
    </div>
  );
}
