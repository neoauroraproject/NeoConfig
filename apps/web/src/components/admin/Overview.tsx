'use client';

import { ArrowLeft, BadgeCheck, Bell, Check, Globe, Image as ImageIcon, Palette, PlugZap, Receipt, Store, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/format';
import type { Section } from './AdminApp';
import { BrandSetup, Overview, adminApi } from './adminApi';
import { Button, Card, PageHeader, StatusDot, errMsg } from './ui';

const STATUS: Record<string, { fa: string; tone: string }> = {
  PENDING: { fa: 'در انتظار', tone: '#e59a12' },
  APPROVED: { fa: 'تأیید شد', tone: '#1fa66a' },
  REJECTED: { fa: 'رد شد', tone: '#d4373f' },
};
const fa = (n: number) => n.toLocaleString('fa-IR');

export function OverviewPage({ go, isAdmin }: { go: (s: Section) => void; isAdmin: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.overview().then(setData).catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <p className="text-sm text-[#d4373f]">{error}</p>;
  if (!data) return <OverviewSkeleton />;

  const foundTotal = data.lookups14d.reduce((n, d) => n + d.found, 0);
  const hitRate = data.lookupsTotal14d ? Math.round((foundTotal / data.lookupsTotal14d) * 100) : null;
  const unhealthy = data.panels.filter((p) => p.healthy === false);
  const approved14 = data.renewals14d.reduce((n, d) => n + d.approved, 0);
  const setupLeft = data.brands.filter((b) => setupScore(b.setup) < SETUP_STEPS.length);

  return (
    <div>
      <PageHeader
        title="داشبورد"
        subtitle={new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date())}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => go('brands')}>
              <Palette className="h-4 w-4" /> برندها
            </Button>
            {isAdmin && (
              <Button variant="secondary" onClick={() => go('panels')}>
                <PlugZap className="h-4 w-4" /> پنل‌ها
              </Button>
            )}
            <Button onClick={() => go('renewals')}>
              <Receipt className="h-4 w-4" /> رسیدها
            </Button>
          </div>
        }
      />

      {data.pendingRenewals > 0 && (
        <button
          type="button"
          onClick={() => go('renewals')}
          className="mb-4 flex w-full items-center justify-between gap-4 rounded-2xl bg-[var(--ink)] px-5 py-4 text-start text-white"
        >
          <span className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e59a12] opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#e59a12]" />
            </span>
            <span className="num text-2xl font-light">{fa(data.pendingRenewals)}</span>
            <span className="text-sm">رسید تمدید منتظر بررسی است</span>
          </span>
          <span className="inline-flex items-center gap-1 text-sm opacity-80">
            بررسی <ArrowLeft className="h-4 w-4" />
          </span>
        </button>
      )}
      {isAdmin && (data.panels.length === 0 || unhealthy.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f2c48d] bg-[#fff7ec] px-5 py-4">
          <p className="text-sm text-[#7a4a0b]">
            {data.panels.length === 0
              ? 'هنوز هیچ پنلی وصل نشده؛ تا وقتی ثنایی، پاسارگارد یا HMPanel وصل نشود، اشتراک‌ها فقط از روی خود لینک خوانده می‌شوند و تمدید خودکار ممکن نیست.'
              : `اتصال ${unhealthy.map((p) => p.name).join('، ')} آخرین بار ناموفق بود.`}
          </p>
          <Button variant="secondary" onClick={() => go('panels')}>
            {data.panels.length === 0 ? 'افزودن پنل' : 'بررسی اتصال'}
          </Button>
        </div>
      )}

      {/* numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="فروش تمدید این ماه" value={data.revenueMonth ? fa(data.revenueMonth) : '—'} sub={data.revenueMonth ? 'تومان' : 'هنوز تمدیدی تأیید نشده'} />
        <Kpi icon={<BadgeCheck className="h-4 w-4" />} label="تمدید تأییدشده این ماه" value={fa(data.approvedThisMonth)} sub={`${fa(approved14)} در ۱۴ روز اخیر`} />
        <Kpi icon={<Users className="h-4 w-4" />} label="اشتراک فعال (۷ روز)" value={fa(data.active7d)} sub={`${fa(data.lookupsTotal14d)} استعلام${hitRate !== null ? ` · ${fa(hitRate)}٪ پیدا شد` : ''}`} />
        <Kpi icon={<Bell className="h-4 w-4" />} label="دستگاه با اعلان فعال" value={fa(data.devices)} sub="یادآوری انقضا و حجم" />
      </div>

      {/* charts */}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <ChartHead title="تمدیدهای روزانه" a={['تأیید', 'var(--ink)']} b={['رد', '#d4373f']} />
          <Bars data={data.renewals14d.map((d) => ({ date: d.date, a: d.approved, b: d.rejected }))} colorA="var(--ink)" colorB="#d4373f" />
        </Card>
        <Card>
          <ChartHead title="استعلام‌های روزانه" a={['پیدا شد', 'var(--ink)']} b={['پیدا نشد', 'var(--accent)']} />
          <Bars data={data.lookups14d.map((d) => ({ date: d.date, a: d.found, b: d.missed }))} colorA="var(--ink)" colorB="var(--accent)" />
        </Card>
      </div>

      {/* brand setup */}
      <Card className="mt-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">راه‌اندازی برندها</h2>
          <span className="text-xs text-[var(--ink-3)]">
            {setupLeft.length ? `${fa(setupLeft.length)} برند کار نیمه‌تمام دارد` : 'همه آماده‌اند ✓'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.brands.map((b) => {
            const score = setupScore(b.setup);
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => go('brands')}
                className="rounded-2xl border border-[var(--line)] p-4 text-start transition-colors hover:bg-[var(--surface-2)]"
              >
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: b.primaryColor }} />
                  <span className="min-w-0 flex-1 truncate font-medium">{b.appName}</span>
                  {!b.active && <span className="text-[11px] text-[var(--ink-3)]">غیرفعال</span>}
                  <span className="num text-xs text-[var(--ink-2)]">
                    {score}/{SETUP_STEPS.length}
                  </span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="h-full rounded-full" style={{ width: `${(score / SETUP_STEPS.length) * 100}%`, background: b.primaryColor }} />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {SETUP_STEPS.map((s) => {
                    const done = s.done(b.setup);
                    return (
                      <li key={s.label} className={`flex items-center gap-2 text-xs ${done ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'}`}>
                        {done ? <Check className="h-3.5 w-3.5 text-[#1fa66a]" /> : <s.icon className="h-3.5 w-3.5" />}
                        {s.text(b.setup)}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-[11px] text-[var(--ink-3)]">{fa(b.devices)} دستگاه با اعلان</p>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">آخرین درخواست‌های تمدید</h2>
            <button type="button" onClick={() => go('renewals')} className="text-xs text-[var(--brand)]">
              همه
            </button>
          </div>
          {data.recentRenewals.length === 0 ? (
            <p className="mt-4 text-sm leading-7 text-[var(--ink-3)]">هنوز درخواستی نیامده. تمدید را در تنظیمات برند روشن کن تا کاربران بتوانند رسید بفرستند.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {data.recentRenewals.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.brand.primaryColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.displayName || '—'}</span>
                    <span className="block truncate text-xs text-[var(--ink-3)]">
                      {r.planTitle} · {relativeTime(r.createdAt, 'fa')}
                    </span>
                  </span>
                  <span className="hidden text-xs text-[var(--ink-2)] sm:inline">{r.price}</span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[11px]"
                    style={{ color: STATUS[r.status]?.tone, background: `color-mix(in srgb, ${STATUS[r.status]?.tone} 12%, transparent)` }}
                  >
                    {STATUS[r.status]?.fa ?? r.status}
                    {r.autoDecided ? ' · خودکار' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">{isAdmin ? 'سلامت پنل‌ها' : 'برندهای شما'}</h2>
            <button type="button" onClick={() => go(isAdmin ? 'panels' : 'brands')} className="text-xs text-[var(--brand)]">
              مدیریت
            </button>
          </div>
          <ul className="mt-3 divide-y divide-[var(--line)]">
            {isAdmin
              ? data.panels.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <StatusDot ok={p.healthy} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block truncate text-xs text-[var(--ink-3)]">
                        {p.type === 'pasarguard' ? 'PasarGuard' : p.type === 'hmpanel' ? 'HMPanel' : '3x-ui ثنایی'}
                        {p.lastTestAt ? ` · ${relativeTime(p.lastTestAt, 'fa')}` : ' · تست نشده'}
                      </span>
                      {p.healthy === false && p.message && <span className="mt-0.5 block truncate text-xs text-[#d4373f]">{p.message}</span>}
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
    </div>
  );
}

const SETUP_STEPS: Array<{ label: string; icon: typeof Check; done: (s: BrandSetup) => boolean; text: (s: BrandSetup) => string }> = [
  { label: 'logo', icon: ImageIcon, done: (s) => s.logo, text: () => 'لوگو' },
  { label: 'domain', icon: Globe, done: (s) => s.domain, text: (s) => (s.domain ? `دامنه با SSL (${s.domainName})` : 'دامنهٔ اختصاصی با SSL') },
  { label: 'renewal', icon: Receipt, done: (s) => s.renewal, text: () => 'تمدید آماده (کارت + پلن)' },
  {
    label: 'reviews',
    icon: Bell,
    done: (s) => s.reviews !== 'admin',
    text: (s) => (s.reviews === 'hmpanel' ? 'رسیدها در ربات HMPanel' : s.reviews === 'telegram' ? 'رسیدها در ربات تلگرام' : 'ربات تلگرام یا فروشگاه HMPanel برای رسیدها'),
  },
  { label: 'hmpanel', icon: Store, done: (s) => s.hmpanel, text: () => 'اتصال HMPanel (اختیاری)' },
];

function setupScore(s: BrandSetup) {
  return SETUP_STEPS.filter((x) => x.done(s)).length;
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

function ChartHead({ title, a, b }: { title: string; a: [string, string]; b: [string, string] }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="font-medium">{title}</h2>
      <p className="flex items-center gap-4 text-xs text-[var(--ink-2)]">
        {[a, b].map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
          </span>
        ))}
      </p>
    </div>
  );
}

function Bars({ data, colorA, colorB }: { data: Array<{ date: string; a: number; b: number }>; colorA: string; colorB: string }) {
  const max = Math.max(1, ...data.map((d) => d.a + d.b));
  return (
    <>
      <div className="mt-6 flex h-36 items-end gap-1.5" dir="ltr" role="img">
        {data.map((d) => {
          const total = d.a + d.b;
          return (
            <div key={d.date} className="flex h-full flex-1 flex-col justify-end gap-[2px]" title={`${d.date}: ${d.a} / ${d.b}`}>
              {total === 0 ? (
                <span className="h-1.5 rounded-full bg-[var(--line)]" />
              ) : (
                <>
                  {d.b > 0 && <span className="rounded-md" style={{ height: `${(d.b / max) * 100}%`, background: colorB }} />}
                  {d.a > 0 && <span className="rounded-md" style={{ height: `${(d.a / max) * 100}%`, background: colorA }} />}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-[var(--ink-3)]" dir="ltr">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-[var(--line)]" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-[var(--surface)]" />
        ))}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="h-56 rounded-2xl bg-[var(--surface)]" />
        <div className="h-56 rounded-2xl bg-[var(--surface)]" />
      </div>
    </div>
  );
}
