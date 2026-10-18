'use client';

import { motion } from 'framer-motion';
import { Bell, Check, Copy, ImagePlus, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, PublicRenewal, RenewalPlan, publicApi } from '@/lib/api';
import type { DictKey } from '@/lib/i18n';
import { groupCard } from '@/lib/format';
import type { PushState } from '@/lib/push';
import { currentEndpoint } from '@/lib/push';
import { useSf } from './context';
import { Sheet } from './Sheet';

type Step = 'plan' | 'pay' | 'sent';

export function RenewSheet({
  open,
  onClose,
  subUrl,
  onSubmitted,
  push,
  onEnablePush,
  serviceKind,
  storeCategoryId,
  panelId,
  sourcePanelRef,
  mode = 'renew',
}: {
  storeCategoryId?: string | null;
  /** The subscription's panel, so only that panel's plans are offered. */
  panelId?: string | null;
  sourcePanelRef?: string | null;
  open: boolean;
  onClose: () => void;
  /** renew: extend this subscription. purchase: buy a new one (HMPanel store plans only). */
  mode?: 'renew' | 'purchase';
  subUrl?: string;
  serviceKind?: 'xui' | 'pasarguard' | null;
  onSubmitted: (r: PublicRenewal) => void;
  push: PushState;
  onEnablePush: () => void;
}) {
  const { brand, t, tenant, toast } = useSf();
  const renewal = brand.renewal;
  const [step, setStep] = useState<Step>('plan');
  const [planId, setPlanId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [payerName, setPayerName] = useState('');
  const [payerNote, setPayerNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Plans for this kind of service only (a 3x-ui plan cannot renew a PasarGuard user).
  const purchase = mode === 'purchase';
  const plans = (renewal?.plans ?? []).filter((p) =>
    purchase
      ? Boolean(p.productId)
      : (!p.service || !serviceKind || p.service === serviceKind) &&
        // Plans tied to a panel only show for subscriptions on that panel.
        (!p.panelId || !panelId || p.panelId === panelId) &&
        (!p.sourcePanelId || !sourcePanelRef || p.sourcePanelId === sourcePanelRef) &&
        // A store-sold service renews only inside its own store category.
        (!storeCategoryId || !p.categoryId || p.categoryId === storeCategoryId),
  );
  // Tabs: the plan's category, or its service type when it has none.
  const groupOf = (p: RenewalPlan) =>
    p.category || p.sourcePanelName || (p.service === 'xui' ? 'V2Ray / Xray' : p.service === 'pasarguard' ? 'PasarGuard' : null);

  const categories = [...new Set(plans.map(groupOf).filter((c): c is string => Boolean(c)))];
  const shown = category ? plans.filter((p) => groupOf(p) === category) : plans;
  // Buying new: categories first (each with its panel/service), then that category's plans.
  const pickCategory = purchase && categories.length > 1 && category === null;

  useEffect(() => {
    if (open) {
      setStep('plan');
      setReceipt(null);
      setError(null);
      setCategory(null);
      setPlanId(plans[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, renewal]);

  const plan = plans.find((p) => p.id === planId) ?? null;

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setReceipt(await compressImage(file));
    } catch {
      setError(t('err_generic'));
    }
  }

  async function send() {
    if (!plan || !receipt) return;
    setBusy(true);
    setError(null);
    try {
      const common = {
        tenant,
        planId: plan.id,
        receipt,
        payerName: payerName.trim() || undefined,
        payerNote: payerNote.trim() || undefined,
        deviceEndpoint: await currentEndpoint(),
      };
      const r = purchase ? await publicApi.createPurchase(common) : await publicApi.createRenewal({ ...common, url: subUrl ?? '' });
      onSubmitted(r);
      setStep('sent');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        err instanceof ApiError && err.status === 0
          ? t('err_network')
          : /already used/i.test(msg)
            ? t('err_receiptUsed')
            : /waiting for review/i.test(msg)
              ? t('err_tooManyPending')
              : /different store category/i.test(msg)
                ? t('err_category')
                : /different panel/i.test(msg)
                  ? t('err_panel')
              : msg || t('err_generic'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!renewal) {
    return (
      <Sheet open={open} onClose={onClose} title={purchase ? t('purchaseTitle') : t('renewTitle')} closeLabel={t('close')}>
        <p className="text-sm leading-7 text-ink-2">{t('renewUnavailable')}</p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={purchase ? t('purchaseTitle') : t('renewTitle')} closeLabel={t('close')}>
      {step === 'plan' && (
        <div>
          <p className="mb-3 text-sm text-ink-2">{pickCategory ? t('chooseCategory') : t('choosePlan')}</p>
          {pickCategory && (
            <div className="grid grid-cols-2 gap-2">
              {categories.map((c) => {
                const inCat = plans.filter((p) => groupOf(p) === c);
                const first = inCat[0];
                const kind = first?.service === 'xui' ? 'V2Ray / Xray' : first?.service === 'pasarguard' ? 'PasarGuard' : first?.sourcePanelName;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCategory(c);
                      if (first) setPlanId(first.id);
                    }}
                    className="flex min-h-[6.5rem] flex-col items-start justify-between rounded-3xl bg-surface-2 p-4 text-start"
                  >
                    <span className="text-[15px] font-semibold text-ink">{c}</span>
                    {kind && kind !== c && <span className="text-[11px] text-ink-3">{kind}</span>}
                    <span className="mt-2 text-xs text-ink-2">
                      {inCat.length} {t('plansCount')}
                      {first?.price ? ` · ${t('fromPrice')} ${first.price}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {!pickCategory && purchase && categories.length > 1 && (
            <button type="button" onClick={() => setCategory(null)} className="mb-3 text-xs font-medium text-brand">
              ← {t('allCategories')}
            </button>
          )}
          {!pickCategory && !purchase && categories.length > 1 && (
            <div className="scrollbar-none -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1" role="tablist" aria-label={t('choosePlan')}>
              {[null, ...categories].map((c) => (
                <button
                  key={c ?? 'all'}
                  type="button"
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => {
                    setCategory(c);
                    const first = (c ? plans.filter((p) => groupOf(p) === c) : plans)[0];
                    if (first) setPlanId(first.id);
                  }}
                  className={`h-9 shrink-0 rounded-full px-4 text-sm ${category === c ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink-2'}`}
                >
                  {c ?? t('allPlans')}
                </button>
              ))}
            </div>
          )}
          {plans.length === 0 && <p className="rounded-3xl bg-surface-2 p-4 text-sm leading-7 text-ink-2">{t('noPlansForService')}</p>}
          <div role="radiogroup" aria-label={t('choosePlan')} className={`space-y-2 ${pickCategory ? 'hidden' : ''}`}>
            {shown.map((p) => {
              const selected = p.id === planId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPlanId(p.id)}
                  className={`flex w-full items-center gap-4 rounded-3xl p-4 text-start transition-colors ${
                    selected ? 'bg-ink text-on-ink' : 'bg-surface-2 text-ink'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{p.title}</span>
                    <span className={`mt-0.5 block text-xs ${selected ? 'opacity-70' : 'text-ink-2'}`}>
                      {planSummary(p, t)}
                    </span>
                  </span>
                  <span className="text-sm font-semibold">{p.price}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={!plan || pickCategory}
            onClick={() => setStep('pay')}
            className="mt-5 h-14 w-full rounded-3xl bg-btn text-sm font-semibold text-btn-ink disabled:opacity-40"
          >
            {t('next')}
          </button>
        </div>
      )}

      {step === 'pay' && plan && (
        <div>
          <p className="text-sm text-ink-2">{t('payTitle')}</p>
          {/* card */}
          <div className="relative mt-3 overflow-hidden rounded-4xl bg-ink p-5 text-on-ink">
            <div
              aria-hidden
              className="absolute -end-10 -top-16 h-40 w-40 rounded-full opacity-40"
              style={{ background: 'radial-gradient(closest-side, var(--brand), transparent)' }}
            />
            <p className="relative text-xs opacity-70">{renewal.bankName || t('cardNumber')}</p>
            <p dir="ltr" className="num relative mt-4 text-[1.35rem] font-normal tracking-wide">
              {groupCard(renewal.cardNumber)}
            </p>
            <div className="relative mt-4 flex items-end justify-between gap-3">
              <div className="min-w-0">
                {renewal.cardHolder && (
                  <>
                    <p className="text-[11px] opacity-60">{t('cardHolder')}</p>
                    <p className="truncate text-sm">{renewal.cardHolder}</p>
                  </>
                )}
              </div>
              <div className="text-end">
                <p className="text-[11px] opacity-60">{t('amount')}</p>
                <p className="text-sm font-semibold">{plan.price}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(renewal.cardNumber);
                toast(t('cardCopied'));
              } catch {
                /* clipboard blocked */
              }
            }}
            className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-3xl bg-surface-2 text-sm font-medium text-ink"
          >
            <Copy className="h-4 w-4" />
            {t('copyCard')}
          </button>
          {renewal.note && <p className="mt-3 text-xs leading-6 text-ink-2">{renewal.note}</p>}

          {/* receipt */}
          <p className="mb-2 mt-5 text-sm font-medium text-ink">{t('receipt')}</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            id="receipt-file"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <label
            htmlFor="receipt-file"
            className="flex min-h-[7rem] cursor-pointer items-center justify-center gap-3 overflow-hidden rounded-3xl border border-dashed border-line bg-surface-2 text-sm text-ink-2"
          >
            {receipt ? (
              <span className="flex w-full items-center gap-3 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receipt} alt="" className="h-20 w-16 rounded-xl object-cover" />
                <span className="flex-1 text-ink">{t('receiptChange')}</span>
              </span>
            ) : (
              <>
                <ImagePlus className="h-5 w-5" />
                {t('receiptPick')}
              </>
            )}
          </label>

          <label htmlFor="payer-name" className="mb-1.5 mt-4 block text-[13px] text-ink-2">
            {purchase ? t('buyerName') : t('payerName')} <span className="text-ink-3">({t('optional')})</span>
          </label>
          <input
            id="payer-name"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            maxLength={80}
            className="h-12 w-full rounded-2xl bg-surface-2 px-4 text-sm text-ink outline-none focus:ring-2 focus:ring-[var(--brand)]"
          />
          <label htmlFor="payer-note" className="mb-1.5 mt-3 block text-[13px] text-ink-2">
            {t('payerNote')}
          </label>
          <textarea
            id="payer-note"
            value={payerNote}
            onChange={(e) => setPayerNote(e.target.value)}
            maxLength={300}
            rows={2}
            className="w-full resize-none rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-[var(--brand)]"
          />

          {error && (
            <p role="alert" className="mt-3 text-[13px] text-[#d4373f]">
              {error}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setStep('plan')} className="h-14 rounded-3xl px-5 text-sm text-ink-2">
              {t('back')}
            </button>
            <button
              type="button"
              disabled={!receipt || busy}
              onClick={send}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-3xl bg-btn text-sm font-semibold text-btn-ink disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t('sending') : t('sendReceipt')}
            </button>
          </div>
        </div>
      )}

      {step === 'sent' && (
        <div className="pb-2 text-center">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 14, stiffness: 220 }}
            className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-btn text-btn-ink"
          >
            <Check className="h-9 w-9" strokeWidth={1.8} />
          </motion.span>
          <h3 className="mt-5 text-lg font-semibold text-ink">{t('sentTitle')}</h3>
          <p className="mx-auto mt-2 max-w-[32ch] text-sm leading-7 text-ink-2">{purchase ? t('purchaseSent') : t('sentBody')}</p>
          {push === 'off' && (
            <button
              type="button"
              onClick={onEnablePush}
              className="mt-5 flex w-full items-center gap-3 rounded-3xl bg-surface-2 p-4 text-start"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-btn text-btn-ink">
                <Bell className="h-4 w-4" />
              </span>
              <span className="flex-1 text-sm text-ink">{t('pushAsk')}</span>
              <span className="text-sm font-medium text-brand">{t('enable')}</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="mt-4 h-14 w-full rounded-3xl bg-ink text-sm font-medium text-on-ink">
            {t('done')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function planSummary(p: RenewalPlan, t: (k: DictKey) => string) {
  const parts: string[] = [];
  if (p.days > 0) parts.push(`+${p.days} ${t('days')}`);
  if (p.mode === 'reset') parts.push(p.gb > 0 ? `${p.gb} ${t('gb')}` : t('unlimited'));
  else if (p.gb > 0) parts.push(`+${p.gb} ${t('gb')}`);
  if (p.users === 1) parts.push(t('singleUser'));
  else if (p.users > 1) parts.push(`${p.users} ${t('usersCount')}`);
  return parts.join(' · ');
}

/** Downscale phone screenshots so uploads stay small on slow mobile data. */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}
