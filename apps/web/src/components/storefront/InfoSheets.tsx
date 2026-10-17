'use client';

import { Copy, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SavedAccount } from '@/lib/accounts';
import { daysUntil, formatBytes, formatDate, relativeTime, usageFraction } from '@/lib/format';
import { APPS, PLATFORM_LABEL, Platform, detectPlatform } from './apps';
import { useSf } from './context';
import { Sheet } from './Sheet';

export function AppsSheet({ open, onClose, account }: { open: boolean; onClose: () => void; account: SavedAccount }) {
  const { t, toast, brand } = useSf();
  const [platform, setPlatform] = useState<Platform>('android');
  useEffect(() => {
    if (open) setPlatform(detectPlatform());
  }, [open]);

  const name = account.label || account.snapshot.displayName || brand.appName;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.url);
      toast(t('copied'));
    } catch {
      toast(t('err_generic'));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('appsTitle')} closeLabel={t('close')}>
      <p className="mb-4 text-sm leading-7 text-ink-2">{t('appsHint')}</p>
      <div className="scrollbar-none -mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1" role="tablist" aria-label={t('appsTitle')}>
        {(Object.keys(APPS) as Platform[]).map((pf) => (
          <button
            key={pf}
            type="button"
            role="tab"
            aria-selected={platform === pf}
            onClick={() => setPlatform(pf)}
            className={`h-10 shrink-0 rounded-full px-4 text-sm ${platform === pf ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink-2'}`}
          >
            {PLATFORM_LABEL[pf]}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {APPS[platform].map((app) => (
          <li key={app.id} className="flex items-center gap-3 rounded-3xl bg-surface-2 p-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface text-sm font-semibold text-ink">
              {app.name.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium text-ink">{app.name}</p>
              {!app.link && <p className="text-xs leading-5 text-ink-3">{t('copyThenImport')}</p>}
            </div>
            <a
              href={app.get}
              target="_blank"
              rel="noreferrer"
              aria-label={`${t('getApp')} ${app.name}`}
              className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2"
            >
              <Download className="h-4 w-4" />
            </a>
            {app.link ? (
              <a href={app.link(account.url, name)} className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-medium text-white">
                {t('addInApp')}
              </a>
            ) : (
              <button type="button" onClick={copy} className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-medium text-on-ink">
                {t('copyLink')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" onClick={copy} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-line text-sm font-medium text-ink">
        <Copy className="h-4 w-4" />
        {t('copyLink')}
      </button>
    </Sheet>
  );
}

export function InfoSheet({ open, onClose, account }: { open: boolean; onClose: () => void; account: SavedAccount }) {
  const { t, locale } = useSf();
  const s = account.snapshot;
  const frac = usageFraction(s.totalUsedBytes, s.quotaKind === 'known' ? s.quotaBytes : null);
  const days = s.expiryKind === 'known' ? daysUntil(s.expiryAt) : null;
  const quota = s.quotaKind === 'unlimited' ? t('unlimited') : s.quotaKind === 'known' ? formatBytes(s.quotaBytes) : t('unknown');
  const remaining = s.quotaKind === 'unlimited' ? t('unlimited') : s.quotaKind === 'known' ? formatBytes(s.remainingBytes) : t('unknown');

  const rows: Array<[string, string, boolean?]> = [
    [t('subscriptionName'), account.label || s.displayName],
    [t('statusLabel'), t(`status_${s.status}` as const)],
    [
      t('lastOnline'),
      account.online ? t('onlineNow') : account.lastOnlineAt ? relativeTime(account.lastOnlineAt, locale) : s.status === 'on_hold' ? t('neverOnline') : t('unknown'),
    ],
    [t('expiresOn'), s.expiryKind === 'none' ? t('noExpiry') : s.expiryKind === 'known' ? formatDate(s.expiryAt, locale) : t('unknown')],
    [t('daysRemaining'), days === null ? (s.expiryKind === 'none' ? '∞' : '—') : String(Math.max(0, days)), true],
    [t('total'), quota, true],
    [t('used'), formatBytes(s.totalUsedBytes), true],
    [t('remaining'), remaining, true],
    ...(frac !== null ? ([[t('usedPercent'), `${Math.round(frac * 100)}%`, true]] as Array<[string, string, boolean]>) : []),
    ...(s.uploadBytes !== null ? ([[t('upload'), formatBytes(s.uploadBytes), true]] as Array<[string, string, boolean]>) : []),
    ...(s.downloadBytes !== null ? ([[t('download'), formatBytes(s.downloadBytes), true]] as Array<[string, string, boolean]>) : []),
    [t('lastSynced'), relativeTime(s.lastSyncAt, locale)],
  ];

  return (
    <Sheet open={open} onClose={onClose} title={t('moreInfo')} closeLabel={t('close')}>
      {frac !== null && (
        <div className="mb-4" aria-hidden>
          <div className="h-2.5 overflow-hidden rounded-full bg-sunk">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, frac * 100)}%` }} />
          </div>
        </div>
      )}
      <dl className="divide-y divide-line rounded-3xl bg-surface-2 px-4">
        {rows.map(([label, value, latin]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className={`text-end text-sm font-medium text-ink ${latin ? 'num text-[13px]' : ''}`} dir={latin ? 'ltr' : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
