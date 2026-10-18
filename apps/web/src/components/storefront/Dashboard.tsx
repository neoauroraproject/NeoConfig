'use client';

import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Grip,
  Home,
  Layers,
  LifeBuoy,
  Plus,
  QrCode,
  RefreshCw,
  RotateCw,
  MonitorSmartphone,
  Smartphone,
  Users,
  Wifi,
} from 'lucide-react';
import { ReactNode } from 'react';
import type { PublicRenewal, SubStatus } from '@/lib/api';
import { SavedAccount, dailyUsage } from '@/lib/accounts';
import { bytesParts, daysUntil, formatBytes, relativeTime, usageFraction } from '@/lib/format';
import { BrandMark } from './BrandMark';
import { useSf } from './context';

type Props = {
  account: SavedAccount;
  accountCount: number;
  refreshing: boolean;
  renewals: PublicRenewal[];
  onRefresh: () => void;
  onApps: () => void;
  onInfo: () => void;
  onQr: () => void;
  onRenew: () => void;
  onAccounts: () => void;
  onAdd: () => void;
  onMenu: () => void;
};

const STATUS_TONE: Record<SubStatus, string> = {
  active: '#1fa66a',
  expiring_soon: '#e59a12',
  expired: '#d4373f',
  limited: '#d4373f',
  on_hold: '#6b7cff',
  disabled: '#8a8c97',
  unknown: '#8a8c97',
};

export function Dashboard(p: Props) {
  const { brand, t, locale } = useSf();
  const s = p.account.snapshot;
  const name = p.account.label || s.displayName;
  const canRenew = Boolean(brand.renewal);

  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[440px] px-5 pb-36 pt-[max(1.5rem,env(safe-area-inset-top))] wide:max-w-[1120px] wide:px-10 wide:pb-32 wide:pt-8">
      {/* header */}
      <header className="flex items-center justify-between">
        <BrandMark brand={brand} size={38} />
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={p.onAccounts}
            className="relative grid h-12 w-12 place-items-center rounded-full bg-surface text-sm font-semibold text-ink shadow-raise-sm"
            aria-label={`${t('accounts')}: ${name}`}
          >
            {initials(name)}
            {p.accountCount > 1 && (
              <span className="num absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] text-white">
                {p.accountCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={p.onMenu}
            aria-label={t('menu')}
            className="grid h-12 w-12 place-items-center rounded-full bg-surface text-ink shadow-raise-sm"
          >
            <Grip className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* desktop: hero + actions on the left, figures on the right */}
      <div className="wide:mt-8 wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] wide:items-start wide:gap-6">
      <div className="wide:sticky wide:top-8 wide:rounded-[2.5rem] wide:bg-surface wide:p-7 wide:shadow-raise">
      {/* hero */}
      <motion.section
        key={p.account.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="sf-hero mt-9 wide:mt-0"
      >
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="truncate font-medium text-ink">{name}</span>
          <span className="text-ink-3">/</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_TONE[s.status] }} />
            {t(`status_${s.status}` as const)}
          </span>
        </div>
        <p className="mt-5 text-[13px] text-ink-2">{t('remaining')}</p>
        <HeroFigure />
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-2">
          {p.account.online ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1fa66a] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1fa66a]" />
              </span>
              {t('onlineNow')}
            </>
          ) : p.account.lastOnlineAt ? (
            `${t('lastOnline')} ${relativeTime(p.account.lastOnlineAt, locale)}`
          ) : s.status === 'on_hold' ? (
            t('neverOnline')
          ) : (
            `${t('updated')} ${relativeTime(s.lastSyncAt, locale)}`
          )}
        </p>
        {p.account.stale && <p className="mt-2 text-[13px] text-[#c27c0e]">{t('staleNote')}</p>}
      </motion.section>

      {/* actions */}
      <nav className="mt-7 grid grid-cols-4 gap-3" aria-label={t('menu')}>
        <RoundAction label={t('refresh')} onClick={p.onRefresh} disabled={p.refreshing}>
          <RefreshCw className={`h-5 w-5 ${p.refreshing ? 'animate-spin' : ''}`} strokeWidth={1.6} />
        </RoundAction>
        {brand.allowCopyLink ? (
          <RoundAction label={t('addToApp')} onClick={p.onApps}>
            <Smartphone className="h-5 w-5" strokeWidth={1.6} />
          </RoundAction>
        ) : (
          <SupportAction />
        )}
        <RoundAction label={t('qr')} onClick={p.onQr}>
          <QrCode className="h-5 w-5" strokeWidth={1.6} />
        </RoundAction>
        {canRenew ? (
          <RoundAction label={t('renew')} onClick={p.onRenew} highlight>
            <RotateCw className="h-5 w-5" strokeWidth={1.6} />
          </RoundAction>
        ) : (
          brand.allowCopyLink && <SupportAction />
        )}
      </nav>

      {p.renewals.length > 0 && <RenewalStrip renewals={p.renewals} />}
      </div>

      <div>
      {/* tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 wide:mt-0">
        <DaysTile expiryAt={s.expiryAt} kind={s.expiryKind} />
        <QuotaTile />
      </div>

      <UsageCard />

      {/* last connection + more info */}
      <section className="mt-3 rounded-[1.75rem] bg-surface p-2 shadow-raise">
        <div className="flex items-center gap-3 border-b border-line px-3 py-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-2">
            <Wifi className="h-4 w-4" />
          </span>
          <span className="flex-1 text-sm text-ink-2">{t('lastOnline')}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
            {p.account.online && <span className="h-2 w-2 rounded-full bg-[#1fa66a]" />}
            {p.account.online
              ? t('onlineNow')
              : p.account.lastOnlineAt
                ? relativeTime(p.account.lastOnlineAt, locale)
                : s.status === 'on_hold'
                  ? t('neverOnline')
                  : t('unknown')}
          </span>
        </div>
        {p.account.deviceLimit != null && (
          <div className="flex items-center gap-3 border-b border-line px-3 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-2">
              <Users className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm text-ink-2">{t('allowedUsers')}</span>
            <span className="num text-sm text-ink">{p.account.deviceLimit > 0 ? p.account.deviceLimit : '∞'}</span>
          </div>
        )}
        {p.account.devicesOnline != null && (
          <div className="flex items-center gap-3 border-b border-line px-3 py-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-2">
              <MonitorSmartphone className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm text-ink-2">{t('devicesNow')}</span>
            <span className="inline-flex items-center gap-1.5">
              {p.account.devicesOnline > 0 && <span className="h-2 w-2 rounded-full bg-[#1fa66a]" />}
              <span className="num text-sm text-ink">
                {p.account.devicesOnline}
                {p.account.deviceLimit ? <span className="text-ink-3"> / {p.account.deviceLimit}</span> : null}
              </span>
            </span>
          </div>
        )}
        <button type="button" onClick={p.onInfo} className="flex w-full items-center gap-3 rounded-3xl px-3 py-3 text-start">
          <span className="flex-1 text-sm font-medium text-ink">{t('moreInfo')}</span>
          {locale === 'fa' ? <ChevronLeft className="h-4 w-4 text-ink-3" /> : <ChevronRight className="h-4 w-4 text-ink-3" />}
        </button>
      </section>
      </div>
      </div>

      {/* bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[440px] items-center gap-3 px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex h-[4.5rem] flex-1 items-center gap-1 rounded-full bg-nav p-1.5 shadow-raise">
          <span className="sf-pill inline-flex h-full items-center gap-2 rounded-full px-5 text-sm font-medium">
            <Home className="h-5 w-5" strokeWidth={1.6} />
            {t('home')}
          </span>
          <button
            type="button"
            onClick={p.onAccounts}
            aria-label={t('accounts')}
            className="grid h-full flex-1 place-items-center rounded-full text-nav-ink opacity-80"
          >
            <Layers className="h-5 w-5" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={canRenew ? p.onRenew : p.onMenu}
            aria-label={canRenew ? t('renew') : t('menu')}
            className="grid h-full flex-1 place-items-center rounded-full text-nav-ink opacity-80"
          >
            {canRenew ? <RotateCw className="h-5 w-5" strokeWidth={1.6} /> : <LifeBuoy className="h-5 w-5" strokeWidth={1.6} />}
          </button>
        </div>
        <button
          type="button"
          onClick={p.onAdd}
          aria-label={t('addAccount')}
          className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-accent text-white shadow-raise"
        >
          <Plus className="h-7 w-7" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );

  function HeroFigure() {
    if (s.quotaKind === 'unlimited') {
      return <p className="num mt-1 text-[3.4rem] font-light leading-tight text-ink">∞</p>;
    }
    const parts = s.quotaKind === 'known' ? bytesParts(s.remainingBytes) : null;
    if (!parts) {
      return <p className="num mt-1 text-[3.4rem] font-light leading-tight text-ink-3">—</p>;
    }
    return (
      <p dir="ltr" className="num mt-1 flex items-baseline gap-2 text-ink" style={{ justifyContent: locale === 'fa' ? 'flex-end' : 'flex-start' }}>
        <span className="text-[3.4rem] font-light leading-tight wide:text-[4.5rem]">
          {parts.int}
          <span className="text-ink-3">{parts.dec}</span>
        </span>
        <span className="text-lg font-normal text-ink-2">{parts.unit}</span>
      </p>
    );
  }

  function QuotaTile() {
    const frac = usageFraction(s.totalUsedBytes, s.quotaKind === 'known' ? s.quotaBytes : null);
    const ticks = 18;
    const filled = frac === null ? 0 : Math.round(frac * ticks);
    return (
      <div className="flex min-h-[11.5rem] flex-col rounded-4xl bg-surface p-5 shadow-raise wide:min-h-[13rem]">
        <p className="text-[13px] text-ink-2">{t('used')}</p>
        <p className="num mt-2 text-xl font-normal leading-tight text-ink" dir="ltr" style={{ textAlign: locale === 'fa' ? 'right' : 'left' }}>
          {formatBytes(s.totalUsedBytes)}
        </p>
        <p className="mt-1 text-xs text-ink-3">
          {t('total')}: {s.quotaKind === 'unlimited' ? t('unlimited') : s.quotaKind === 'known' ? formatBytes(s.quotaBytes) : t('unknown')}
        </p>
        <div className="mt-auto flex h-7 items-center gap-[3px] pt-3" dir="ltr" aria-hidden>
          {Array.from({ length: ticks }).map((_, i) => (
            <span
              key={i}
              className="h-full flex-1 rounded-full"
              style={{
                background: i < filled ? 'var(--ink)' : 'var(--surface-sunk)',
                opacity: i < filled ? 0.9 : 1,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  function UsageCard() {
    const days = dailyUsage(p.account.history, 14);
    const values = days.map((d) => d.bytes ?? 0);
    const max = Math.max(...values, 1);
    const hasData = days.some((d) => d.bytes !== null && d.bytes > 0);
    const todayBytes = days[days.length - 1]?.bytes;
    // Until two days are recorded there is nothing to draw; the connections card carries the screen.
    if (!hasData) return null;
    return (
      <section className="mt-3 rounded-[2.25rem] bg-surface p-5 shadow-raise">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-medium text-ink">{t('dailyUsage')}</h2>
          {hasData && (
            <p className="text-xs text-ink-2">
              {t('today')}{' '}
              <span className="num text-sm text-ink" dir="ltr">
                {formatBytes(todayBytes ?? 0)}
              </span>
            </p>
          )}
        </div>
        <div className="mt-5 flex h-24 items-end gap-[6px] wide:h-36" dir="ltr" role="img" aria-label={t('dailyUsage')}>
          {days.map((d, i) => {
            const isToday = i === days.length - 1;
            const h = hasData ? Math.max(12, ((d.bytes ?? 0) / max) * 100) : 14 + ((i * 37) % 50);
            return (
              <span
                key={d.d}
                title={`${d.d}: ${d.bytes === null ? '—' : formatBytes(d.bytes)}`}
                className="flex-1 rounded-full transition-all"
                style={{
                  height: `${h}%`,
                  background: !hasData ? 'var(--surface-sunk)' : isToday ? 'var(--signal)' : 'var(--ink)',
                  opacity: !hasData ? 1 : isToday ? 1 : d.bytes === null ? 0.12 : 0.85,
                }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex gap-[6px]" dir="ltr" aria-hidden>
          {days.map((d, i) => (
            <span key={d.d} className="flex-1">
              <span className={`mx-auto block w-[3px] rounded-full bg-sunk ${i % 2 ? 'h-2' : 'h-3'}`} />
            </span>
          ))}
        </div>
        {!hasData && <p className="mt-3 text-xs leading-6 text-ink-3">{t('dailyUsageEmpty')}</p>}
      </section>
    );
  }

  function SupportAction() {
    const href = brand.supportTelegram
      ? `https://t.me/${brand.supportTelegram.replace(/^@/, '')}`
      : brand.supportUrl || (brand.contactEmail ? `mailto:${brand.contactEmail}` : null);
    if (!href) return null;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-2">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-surface text-ink shadow-raise-sm">
          <LifeBuoy className="h-5 w-5" strokeWidth={1.6} />
        </span>
        <span className="text-xs text-ink-2">{t('support')}</span>
      </a>
    );
  }
}

function DaysTile({ expiryAt, kind }: { expiryAt: string | null; kind: string }) {
  const { t } = useSf();
  const days = kind === 'known' ? Math.max(0, daysUntil(expiryAt) ?? 0) : null;
  const scale = days === null ? 30 : days <= 30 ? 30 : days <= 90 ? 90 : 365;
  const frac = days === null ? (kind === 'none' ? 1 : 0) : Math.min(1, days / scale);
  // Arc from the bottom-left around to the top, like a dial face.
  const r = 46;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const a = start + sweep * frac;
  const pt = (ang: number) => [60 + r * Math.cos(ang), 60 + r * Math.sin(ang)];
  const [sx, sy] = pt(start);
  const [ex, ey] = pt(start + sweep);
  const [kx, ky] = pt(a);
  const large = sweep * frac > Math.PI ? 1 : 0;
  const [fx, fy] = pt(a);

  return (
    <div className="relative flex min-h-[11.5rem] flex-col overflow-hidden rounded-4xl p-5 shadow-raise wide:min-h-[13rem]" style={{ background: 'var(--hi)', color: 'var(--on-hi)' }}>
      <svg viewBox="0 0 120 120" className="absolute end-2 top-2 h-24 w-24" aria-hidden>
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        {frac > 0 && (
          <path d={`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${fx} ${fy}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        )}
        <circle cx={kx} cy={ky} r="5" fill="currentColor" />
      </svg>
      <p className="relative mt-auto num text-[2.6rem] font-light leading-none">
        {days === null ? (kind === 'none' ? '∞' : '—') : days}
      </p>
      <p className="relative mt-2 text-[13px] opacity-85">{days === null && kind === 'none' ? t('noExpiry') : t('daysLeft')}</p>
    </div>
  );
}

function RoundAction({
  label,
  onClick,
  children,
  disabled,
  highlight,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="group flex flex-col items-center gap-2 disabled:opacity-60">
      <span
        className={`grid h-16 w-16 place-items-center rounded-full shadow-raise-sm ${
          highlight ? 'bg-ink text-on-ink' : 'bg-surface text-ink'
        }`}
      >
        {children}
      </span>
      <span className="text-xs text-ink-2">{label}</span>
    </button>
  );
}

function RenewalStrip({ renewals }: { renewals: PublicRenewal[] }) {
  const { t } = useSf();
  const r = renewals[0];
  const tone = r.status === 'approved' ? '#1fa66a' : r.status === 'rejected' ? '#d4373f' : '#e59a12';
  return (
    <div className="mt-6 flex items-center gap-3 rounded-3xl bg-surface px-4 py-3.5 shadow-raise-sm">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tone }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{r.planTitle}</p>
        <p className="truncate text-xs text-ink-2">
          {t(r.status)}
          {r.adminNote ? ` — ${r.adminNote}` : ''}
        </p>
      </div>
    </div>
  );
}

function initials(name: string) {
  const clean = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  // Persian/Arabic letters change shape when isolated pairs are joined; one letter reads cleaner.
  if (!/^[A-Za-z0-9]/.test(parts[0])) return parts[0][0];
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
