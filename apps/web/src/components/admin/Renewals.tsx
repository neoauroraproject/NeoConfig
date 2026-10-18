'use client';

import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { relativeTime } from '@/lib/format';
import { AdminRenewal, adminApi } from './adminApi';
import { Button, Card, Empty, PageHeader, errMsg } from './ui';

const TABS = [
  { id: 'PENDING', label: 'در انتظار' },
  { id: 'APPROVED', label: 'تأییدشده' },
  { id: 'REJECTED', label: 'ردشده' },
] as const;

export function Renewals() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('PENDING');
  const [rows, setRows] = useState<AdminRenewal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setRows(null);
    adminApi.renewals(tab).then(setRows).catch((e) => setError(errMsg(e)));
  };
  useEffect(load, [tab]);

  return (
    <div>
      <PageHeader title="تمدیدها" subtitle="رسید را ببین، تأیید کن؛ کاربر همان لحظه اعلان می‌گیرد." />
      <div className="mb-4 inline-flex rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-9 rounded-lg px-4 text-sm ${tab === t.id ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 text-sm text-[#d4373f]">{error}</p>}
      {rows === null ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-[var(--surface)]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty
          title={tab === 'PENDING' ? 'رسیدی منتظر بررسی نیست' : 'موردی نیست'}
          body={tab === 'PENDING' ? 'وقتی کاربری از اپ رسید بفرستد، اینجا نمایش داده می‌شود.' : 'درخواست‌های بررسی‌شده اینجا جمع می‌شوند.'}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RenewalCard key={r.id} r={r} onDone={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function RenewalCard({ r, onDone }: { r: AdminRenewal; onDone: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'auto' | 'manual' | 'reject' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pending = r.status === 'PENDING';

  useEffect(() => {
    let url: string | null = null;
    adminApi
      .receiptUrl(r.id)
      .then((u) => {
        url = u;
        setImg(u);
      })
      .catch(() => setImg(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [r.id]);

  async function decide(kind: 'auto' | 'manual' | 'reject') {
    setBusy(kind);
    setMsg(null);
    try {
      if (kind !== 'reject') await adminApi.approve(r.id, kind === 'auto', note || undefined);
      else await adminApi.reject(r.id, note || undefined);
      onDone();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="!p-4">
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => img && setZoom(true)}
          className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--surface-2)]"
          aria-label="نمایش بزرگ رسید"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img && <img src={img} alt="رسید پرداخت" className="h-full w-full object-cover" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.brand.primaryColor }} />
            <p className="font-medium">{r.displayName || r.subId}</p>
            <span className="text-xs text-[var(--ink-3)]">{r.brand.appName}</span>
            {r.kind === 'purchase' && (
              <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[11px] text-white">خرید جدید</span>
            )}
            {r.via === 'hmpanel' && (
              <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]">HMPanel{r.externalCode ? ` · ${r.externalCode}` : ''}</span>
            )}
            <span className="ms-auto text-xs text-[var(--ink-3)]">{relativeTime(r.createdAt, 'fa')}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            {r.planTitle} · <span className="font-medium text-[var(--ink)]">{r.price}</span>
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-3)]">
            {r.days > 0 ? `${r.days} روز` : 'بدون تغییر زمان'} · {r.gb > 0 ? `${r.gb} گیگ` : 'نامحدود'}
            {r.payerName ? ` · واریزکننده: ${r.payerName}` : ''}
          </p>
          {r.payerNote && <p className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm">{r.payerNote}</p>}
          {!pending && (
            <p className="mt-2 text-xs text-[var(--ink-2)]">
              {r.status === 'APPROVED'
                ? r.appliedOnPanel
                  ? `روی پنل اعمال شد (${r.applyMessage})`
                  : 'تأیید شد؛ تمدید دستی توسط ادمین'
                : 'رد شد'}
              {r.adminNote ? ` · یادداشت: ${r.adminNote}` : ''}
            </p>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <label htmlFor={`note-${r.id}`} className="mb-1.5 block text-[13px] text-[var(--ink-2)]">
            یادداشت برای کاربر (اختیاری)
          </label>
          <input
            id={`note-${r.id}`}
            className="field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="مثلاً: مبلغ واریزی کمتر از پلن است"
          />
          {r.via === 'hmpanel' ? (
          <>
          <p className="mt-3 text-xs leading-6 text-[var(--ink-3)]">
            این سفارش در فروشگاه HMPanel است{r.externalCode ? ` (کد ${r.externalCode})` : ''}؛ با تأیید، HMPanel تمدید را انجام می‌دهد و از اعتبار همان ادمین کم می‌شود. تأیید از ربات HMPanel هم اینجا خودکار ثبت می‌شود.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" busy={busy === 'reject'} disabled={busy !== null} onClick={() => decide('reject')}>
              <X className="h-4 w-4" /> رد رسید
            </Button>
            <Button busy={busy === 'auto'} disabled={busy !== null} onClick={() => decide('auto')}>
              <Check className="h-4 w-4" /> تأیید در HMPanel
            </Button>
          </div>
          </>
          ) : (
          <>
          <p className="mt-3 text-xs leading-6 text-[var(--ink-3)]">
            <b>تمدید خودکار</b>: همین حالا روی پنل تمدید می‌شود. <b>تمدید دستی</b>: فقط رسید تأیید می‌شود و خودت روی پنل تمدید می‌کنی.
            {!r.canApply && ' — موقع ثبت، این اشتراک روی پنل‌ها پیدا نشد؛ تمدید خودکار دوباره جست‌وجو می‌کند.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" busy={busy === 'reject'} disabled={busy !== null} onClick={() => decide('reject')}>
              <X className="h-4 w-4" /> رد رسید
            </Button>
            <Button variant="secondary" busy={busy === 'manual'} disabled={busy !== null} onClick={() => decide('manual')}>
              <Check className="h-4 w-4" /> تأیید، تمدید دستی
            </Button>
            <Button busy={busy === 'auto'} disabled={busy !== null} onClick={() => decide('auto')}>
              <Check className="h-4 w-4" /> تأیید و تمدید خودکار
            </Button>
          </div>
          </>
          )}
          {msg && (
            <p role="alert" className="mt-3 text-sm text-[#d4373f]">
              {msg}
            </p>
          )}
        </div>
      )}

      {zoom && img && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="رسید" onClick={() => setZoom(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="رسید پرداخت" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </Card>
  );
}
