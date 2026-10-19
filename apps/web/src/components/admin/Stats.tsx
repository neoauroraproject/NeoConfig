'use client';

import { Download, Globe, Laptop, Monitor, Smartphone, Tablet, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/format';
import { StatsOverview, adminApi } from './adminApi';
import { Card, PageHeader, errMsg } from './ui';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** One color per platform, used in the chart, the legend and the breakdown. */
const PLATFORM: Record<string, { fa: string; color: string; icon: typeof Smartphone }> = {
  iPhone: { fa: 'آیفون', color: '#111318', icon: Smartphone },
  Android: { fa: 'اندروید', color: '#1fa66a', icon: Smartphone },
  iPad: { fa: 'آیپد', color: '#6b7cff', icon: Tablet },
  Windows: { fa: 'ویندوز', color: '#2f80ed', icon: Monitor },
  macOS: { fa: 'مک', color: '#8a8c97', icon: Laptop },
  Linux: { fa: 'لینوکس', color: '#e59a12', icon: Monitor },
  Other: { fa: 'دیگر', color: '#c7c9d3', icon: Globe },
};
const p = (name: string) => PLATFORM[name] ?? PLATFORM.Other;

export function StatsPage() {
  const [data, setData] = useState<StatsOverview | null>(null);
  const [brandId, setBrandId] = useState('');
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    adminApi
      .stats(brandId || undefined, days)
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  }, [brandId, days]);

  if (error) return <p className="text-sm text-[#d4373f]">{error}</p>;
  if (!data) return <div className="h-64 animate-pulse rounded-2xl bg-[var(--surface)]" />;

  const t = data.totals;
  const max = Math.max(1, ...data.series.map((d) => Math.max(d.devices, d.subscriptions)));
  const platforms = Object.keys(PLATFORM).filter((k) => data.series.some((d) => d.byPlatform[k]));
  const installedPct = t.devices ? Math.round((t.installed / t.devices) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="آمار کاربران"
        subtitle="چند نفر، با چه دستگاه‌هایی، اپ را باز کردند و اشتراک اضافه کردند"
        action={
          <div className="flex flex-wrap gap-2">
            {data.brands.length > 1 && (
              <select className="field !w-auto" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="برند">
                <option value="">همهٔ برندها</option>
                {data.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.appName}
                  </option>
                ))}
              </select>
            )}
            <div className="flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1" role="group" aria-label="بازه">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                  className={`h-8 rounded-lg px-3 text-xs ${days === d ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)]'}`}
                >
                  {fa(d)} روز
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<UserPlus className="h-4 w-4" />} label="دستگاه جدید امروز" value={fa(t.newToday)} sub={`${fa(t.new7d)} در ۷ روز اخیر`} />
        <Kpi icon={<Users className="h-4 w-4" />} label="کل دستگاه‌ها" value={fa(t.devices)} sub={`${fa(t.active7d)} فعال در ۷ روز`} />
        <Kpi icon={<Smartphone className="h-4 w-4" />} label={`اشتراک جدید (${fa(data.days)} روز)`} value={fa(t.newSubscriptions)} sub={`${fa(t.subscriptions)} اشتراک در کل`} />
        <Kpi icon={<Download className="h-4 w-4" />} label="نصب‌شده روی صفحهٔ اصلی" value={`${fa(installedPct)}٪`} sub={`${fa(t.installed)} دستگاه`} />
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">ورودی‌های روزانه</h2>
          <p className="flex flex-wrap items-center gap-3 text-xs text-[var(--ink-2)]">
            {platforms.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: p(k).color }} /> {p(k).fa}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full bg-[var(--accent)]" /> اشتراک جدید
            </span>
          </p>
        </div>
        <div className="relative mt-6 flex h-48 items-end gap-[3px]" dir="ltr" role="img" aria-label="دستگاه‌ها و اشتراک‌های جدید هر روز">
          {data.series.map((d) => (
            <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.devices} دستگاه، ${d.subscriptions} اشتراک`}>
              {d.devices === 0 ? (
                <span className="h-1 rounded-full bg-[var(--line)]" />
              ) : (
                platforms.map((k) =>
                  d.byPlatform[k] ? (
                    <span key={k} className="first:rounded-t-md" style={{ height: `${(d.byPlatform[k] / max) * 100}%`, background: p(k).color }} />
                  ) : null,
                )
              )}
              {d.subscriptions > 0 && (
                <span
                  className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]"
                  style={{ bottom: `calc(${(d.subscriptions / max) * 100}% - 3px)` }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-[var(--ink-3)]" dir="ltr">
          <span>{data.series[0]?.date.slice(5)}</span>
          <span>{data.series[data.series.length - 1]?.date.slice(5)}</span>
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Breakdown title="دستگاه‌ها" rows={data.platforms.map((r) => ({ ...r, label: p(r.name).fa, color: p(r.name).color }))} total={t.devices} />
        <Breakdown title="مرورگر / برنامه" rows={data.browsers.map((r) => ({ ...r, label: r.name === 'Other' ? 'دیگر' : r.name, color: 'var(--brand)' }))} total={t.devices} />
      </div>

      <Card className="mt-3">
        <h2 className="font-medium">آخرین اشتراک‌های اضافه‌شده</h2>
        {data.recent.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--ink-3)]">هنوز کسی از این نسخه به بعد اشتراکی اضافه نکرده.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {data.recent.map((r, i) => {
              const plat = p(r.platform);
              const Icon = plat.icon;
              return (
                <li key={`${r.at}-${i}`} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white" style={{ background: plat.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.name || '—'}</span>
                    <span className="block truncate text-xs text-[var(--ink-3)]">
                      {plat.fa} · دستگاه …{r.device}
                      {data.brands.length > 1 ? ` · ${r.brand.appName}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--ink-2)]">{relativeTime(r.at, 'fa')}</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-5 text-[var(--ink-3)]">
          هر دستگاه با یک شناسهٔ تصادفی ناشناس شمرده می‌شود؛ نام، شماره یا IP ذخیره نمی‌شود. آمار از همین نسخه شروع می‌شود.
        </p>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
      <p className="flex items-center gap-2 text-[13px] text-[var(--ink-2)]">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--surface-2)]">{icon}</span>
        {label}
      </p>
      <p className="num mt-3 text-[1.75rem] font-light leading-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--ink-3)]">{sub}</p>}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: Array<{ name: string; label: string; count: number; color: string }>; total: number }) {
  return (
    <Card>
      <h2 className="font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--ink-3)]">هنوز داده‌ای نیست.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => {
            const pct = total ? Math.round((r.count / total) * 100) : 0;
            return (
              <li key={r.name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>{r.label}</span>
                  <span className="text-xs text-[var(--ink-2)]">
                    {fa(r.count)} · {fa(pct)}٪
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: r.color }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
