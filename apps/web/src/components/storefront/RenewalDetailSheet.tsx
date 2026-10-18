'use client';

import { Check, Clock, LifeBuoy, RotateCw, X } from 'lucide-react';
import type { PublicRenewal } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import { useSf } from './context';
import { Sheet } from './Sheet';

/** One renewal or purchase: where it stands, why it was refused, and how to get help. */
export function RenewalDetailSheet({
  renewal,
  onClose,
  onRetry,
}: {
  renewal: PublicRenewal | null;
  onClose: () => void;
  onRetry: (r: PublicRenewal) => void;
}) {
  const { t, brand, locale } = useSf();
  const r = renewal;
  const support = brand.supportTelegram
    ? `https://t.me/${brand.supportTelegram.replace(/^@/, '')}`
    : brand.supportUrl || (brand.contactEmail ? `mailto:${brand.contactEmail}` : null);
  const purchase = r?.kind === 'purchase';
  const tone = r?.status === 'approved' ? '#1fa66a' : r?.status === 'rejected' ? '#d4373f' : '#e59a12';
  const Icon = r?.status === 'approved' ? Check : r?.status === 'rejected' ? X : Clock;

  return (
    <Sheet open={Boolean(r)} onClose={onClose} title={purchase ? t('purchaseTitle') : t('renewTitle')} closeLabel={t('close')}>
      {r && (
        <div>
          <div className="flex items-center gap-3 rounded-3xl bg-surface-2 p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white" style={{ background: tone }}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-ink">{t(r.status)}</p>
              <p className="truncate text-xs text-ink-2">
                {r.planTitle} · {r.price}
              </p>
            </div>
          </div>

          {r.status === 'rejected' && (
            <div className="mt-3 rounded-3xl border border-[#d4373f]/30 p-4" style={{ borderColor: 'color-mix(in srgb, #d4373f 30%, transparent)' }}>
              <p className="text-xs text-ink-3">{t('rejectReason')}</p>
              <p className="mt-1 text-sm leading-7 text-ink">{r.adminNote || t('rejectNoReason')}</p>
            </div>
          )}
          {r.status === 'pending' && <p className="mt-3 text-sm leading-7 text-ink-2">{purchase ? t('purchasePending') : t('sentBody')}</p>}
          {r.status === 'approved' && r.adminNote && <p className="mt-3 text-sm leading-7 text-ink-2">{r.adminNote}</p>}

          <dl className="mt-3 divide-y divide-line rounded-3xl bg-surface-2 px-4 text-sm">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-ink-2">{t('sentAt')}</dt>
              <dd className="text-ink">{formatDate(r.createdAt, locale)}</dd>
            </div>
            {r.decidedAt && (
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-ink-2">{t('decidedAt')}</dt>
                <dd className="text-ink">{relativeTime(r.decidedAt, locale)}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 grid gap-2">
            {r.status === 'rejected' && (
              <button
                type="button"
                onClick={() => onRetry(r)}
                className="flex h-14 items-center justify-center gap-2 rounded-3xl bg-brand text-sm font-semibold text-white"
              >
                <RotateCw className="h-4 w-4" /> {t('sendAgain')}
              </button>
            )}
            {support && (
              <a
                href={support}
                target="_blank"
                rel="noreferrer"
                className="flex h-14 items-center justify-center gap-2 rounded-3xl bg-surface-2 text-sm font-medium text-ink"
              >
                <LifeBuoy className="h-4 w-4" /> {t('contactSupport')}
              </a>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
