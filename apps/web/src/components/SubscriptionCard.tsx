'use client';

import { motion } from 'framer-motion';
import { RefreshCw, LifeBuoy, Trash2 } from 'lucide-react';
import { SubscriptionDto } from '@/lib/api';
import { expiryLabel, formatBytes, statusLabel, usagePercent } from '@/lib/format';
import { Locale, t } from '@/lib/i18n';
import { TrafficRing } from './TrafficRing';

type Props = {
  sub: SubscriptionDto;
  locale: Locale;
  supportUrl?: string | null;
  renewAvailable?: boolean;
  onRefresh: () => void;
  onRenew?: () => void;
  onDelete: () => void;
  refreshing?: boolean;
};

export function SubscriptionCard({
  sub,
  locale,
  supportUrl,
  renewAvailable,
  onRefresh,
  onRenew,
  onDelete,
  refreshing,
}: Props) {
  const s = sub.snapshot;
  const status = s?.status || 'unknown';
  const percent = usagePercent(
    s?.totalUsedBytes ?? null,
    s?.quotaBytes ?? null,
    s?.quotaKind || 'unknown',
  );

  const usedLabel =
    s?.quotaKind === 'unlimited'
      ? formatBytes(s.totalUsedBytes, locale)
      : s?.quotaKind === 'known'
        ? formatBytes(s.totalUsedBytes, locale)
        : t(locale, 'unknown');

  const totalLabel =
    s?.quotaKind === 'unlimited'
      ? t(locale, 'unlimited')
      : s?.quotaKind === 'known'
        ? formatBytes(s.quotaBytes, locale)
        : t(locale, 'unknown');

  const remainingLabel =
    s?.quotaKind === 'known'
      ? formatBytes(s.remainingBytes, locale)
      : s?.quotaKind === 'unlimited'
        ? t(locale, 'unlimited')
        : t(locale, 'unknown');

  const statusTone =
    status === 'active'
      ? 'bg-emerald-500/15 text-emerald-300'
      : status === 'expiring_soon'
        ? 'bg-amber-500/15 text-amber-300'
        : status === 'expired' || status === 'disabled'
          ? 'bg-rose-500/15 text-rose-300'
          : 'bg-white/10 text-white/70';

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface rounded-3xl p-6 shadow-soft"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {sub.displayName}
          </h1>
          <p className="muted mt-1 text-xs">
            {s?.syncState === 'failed' || s?.syncState === 'stale'
              ? t(locale, 'stale')
              : t(locale, 'lastUpdated')}
            {s?.lastSyncAt
              ? ` · ${new Date(s.lastSyncAt).toLocaleString(locale)}`
              : ''}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusTone}`}>
          {statusLabel(status, locale)}
        </span>
      </div>

      <TrafficRing
        percent={percent}
        label={t(locale, 'used')}
        sublabel={`${usedLabel} / ${totalLabel}`}
      />

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        <Stat label={t(locale, 'used')} value={usedLabel} />
        <Stat label={t(locale, 'remaining')} value={remainingLabel} />
        <Stat
          label={t(locale, 'expires')}
          value={expiryLabel(s?.expiryAt ?? null, s?.expiryKind || 'unknown', locale)}
        />
      </div>

      {(s?.uploadBytes != null || s?.downloadBytes != null) && (
        <div className="muted mt-4 flex justify-center gap-4 text-xs">
          <span>
            {t(locale, 'upload')}: {formatBytes(s.uploadBytes, locale)}
          </span>
          <span>
            {t(locale, 'download')}: {formatBytes(s.downloadBytes, locale)}
          </span>
        </div>
      )}

      {(sub.refreshError || s?.lastSyncError) && (
        <p className="mt-4 text-center text-xs text-amber-300/90">
          {t(locale, 'syncFailed')}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-2xl bg-brand px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {t(locale, 'refresh')}
        </button>
        {renewAvailable && onRenew && (
          <button
            type="button"
            onClick={onRenew}
            className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm"
          >
            {t(locale, 'renew')}
          </button>
        )}
        {supportUrl && (
          <a
            href={supportUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2.5 text-sm"
          >
            <LifeBuoy className="h-4 w-4" />
            {t(locale, 'support')}
          </a>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-rose-300/80"
          aria-label={t(locale, 'delete')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </motion.section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/10 px-2 py-3 dark:bg-white/5">
      <div className="muted text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
