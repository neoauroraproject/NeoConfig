'use client';

import { CreditCard, Download, Loader2, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RenewalPlan } from '@/lib/api';
import { AdminBrand, HmCard, HmProduct, adminApi } from './adminApi';
import { Button, Card, errMsg } from './ui';

const GB = 1024 ** 3;
const fa = (n: number) => n.toLocaleString('fa-IR');

type SetFn = <K extends keyof AdminBrand>(k: K, v: AdminBrand[K]) => void;

/**
 * Optional link to an HMPanel admin: pick its payment cards, import its store
 * products as plans, and (optionally) send receipts to its store so HMPanel's
 * own bot and panel approve them — the renewal then comes out of that admin's credit.
 */
export function HmPanelRenewal({ draft, set }: { draft: AdminBrand; set: SetFn }) {
  const [panels, setPanels] = useState<Array<{ id: string; name: string; host: string }> | null>(null);
  const [cards, setCards] = useState<HmCard[] | null>(null);
  const [busy, setBusy] = useState<'cards' | 'products' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const panelId = draft.renewalPanelId ?? '';

  useEffect(() => {
    adminApi
      .hmpanelPanels(draft.id)
      .then(setPanels)
      .catch(() => setPanels([]));
  }, [draft.id]);

  if (panels === null) return null;
  if (panels.length === 0) {
    return (
      <Card>
        <h2 className="flex items-center gap-2 font-medium">
          <Store className="h-4 w-4" /> اتصال به HMPanel
        </h2>
        <p className="mt-1 text-sm leading-7 text-[var(--ink-2)]">
          با وصل کردن یک پنل HMPanel (اتصال پنل‌ها ← HMPanel)، کارت‌ها و پلن‌ها از همان‌جا می‌آیند و رسیدها می‌توانند مستقیم به فروشگاه و ربات HMPanel بروند.
        </p>
      </Card>
    );
  }

  async function loadCards() {
    if (!panelId) return;
    setBusy('cards');
    setMsg(null);
    try {
      const list = await adminApi.hmpanelCards(draft.id, panelId);
      setCards(list);
      if (!list.length) setMsg({ ok: false, text: 'در فروشگاه HMPanel کارت فعالی ثبت نشده.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function importProducts() {
    if (!panelId) return;
    setBusy('products');
    setMsg(null);
    try {
      const products = await adminApi.hmpanelProducts(draft.id, panelId);
      if (!products.length) {
        setMsg({ ok: false, text: 'محصول قابل تمدیدی در فروشگاه HMPanel نیست.' });
        return;
      }
      const linked = new Map(draft.plans.filter((p) => p.productId).map((p) => [p.productId, p]));
      const fromStore: RenewalPlan[] = products.slice(0, 12).map((p: HmProduct) => {
        const prev = linked.get(p.id);
        return {
          id: prev?.id ?? `p${p.id.slice(-10)}`,
          title: prev?.title ?? p.name.slice(0, 60),
          days: p.durationDays,
          gb: p.trafficBytes > 0 ? +(p.trafficBytes / GB).toFixed(2) : 0,
          price: p.priceToman ? `${fa(p.priceToman)} تومان` : prev?.price ?? '',
          users: p.ipLimitOptions?.[0] ?? prev?.users ?? 0,
          mode: 'reset',
          productId: p.id,
        };
      });
      const manual = draft.plans.filter((p) => !p.productId);
      set('plans', [...fromStore, ...manual].slice(0, 12));
      setMsg({ ok: true, text: `${fa(fromStore.length)} پلن از فروشگاه HMPanel وارد شد. «ذخیره تغییرات» را بزن.` });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  const unlinked = draft.renewalVia === 'hmpanel' ? draft.plans.filter((p) => !p.productId).length : 0;

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-medium">
        <Store className="h-4 w-4" /> اتصال به HMPanel
      </h2>
      <p className="mt-1 text-sm leading-7 text-[var(--ink-2)]">کارت‌ها، پلن‌ها و بررسی رسید را از فروشگاه همان ادمین HMPanel بگیر.</p>

      <label htmlFor="hm-panel" className="mb-1.5 mt-4 block text-[13px] text-[var(--ink-2)]">
        پنل HMPanel
      </label>
      <select
        id="hm-panel"
        className="field max-w-md"
        value={panelId}
        onChange={(e) => {
          set('renewalPanelId', e.target.value || null);
          if (!e.target.value) set('renewalVia', 'local');
          setCards(null);
        }}
      >
        <option value="">— وصل نیست —</option>
        {panels.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.host})
          </option>
        ))}
      </select>

      {panelId && (
        <>
          <fieldset className="mt-5">
            <legend className="mb-2 text-[13px] text-[var(--ink-2)]">رسیدها کجا بررسی شوند؟</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ['local', 'در NeoConfig', 'ربات خود برند و صفحهٔ «رسیدها»؛ تأیید خودکار یا دستی.'],
                  ['hmpanel', 'در فروشگاه HMPanel', 'سفارش در فروشگاه HMPanel ثبت می‌شود؛ ربات و پنل HMPanel تأیید می‌کنند و از اعتبار همان ادمین کم می‌شود. ربات جدا لازم نیست.'],
                ] as const
              ).map(([v, title, hint]) => (
                <label
                  key={v}
                  className={`cursor-pointer rounded-2xl border p-3 ${draft.renewalVia === v ? 'border-[var(--ink)] bg-[var(--surface-2)]' : 'border-[var(--line)]'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input type="radio" name="renewal-via" checked={draft.renewalVia === v} onChange={() => set('renewalVia', v)} />
                    {title}
                  </span>
                  <span className="mt-1 block text-xs leading-6 text-[var(--ink-3)]">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={loadCards} disabled={busy !== null}>
              {busy === 'cards' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} کارت‌ها از HMPanel
            </Button>
            <Button variant="secondary" onClick={importProducts} disabled={busy !== null}>
              {busy === 'products' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} پلن‌ها از محصولات HMPanel
            </Button>
          </div>

          {cards && cards.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {cards.map((c) => {
                const on = (draft.cardNumber ?? '').replace(/\D/g, '') === c.cardNumber.replace(/\D/g, '');
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      set('cardNumber', c.cardNumber);
                      set('cardHolder', c.cardHolder ?? '');
                      set('bankName', c.bankName ?? '');
                    }}
                    className={`rounded-2xl border p-3 text-start ${on ? 'border-[var(--ink)] bg-[var(--surface-2)]' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}
                  >
                    <span className="block text-xs text-[var(--ink-3)]">{c.bankName || 'کارت'}</span>
                    <span dir="ltr" className="num mt-1 block text-sm">
                      {c.cardNumber.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--ink-2)]">{c.cardHolder}</span>
                    {on && <span className="mt-1 block text-[11px] text-[#1d6b41]">انتخاب شده ✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {unlinked > 0 && (
            <p className="mt-3 text-xs text-[#b4541a]">
              {fa(unlinked)} پلن به محصول HMPanel وصل نیست و در حالت «فروشگاه HMPanel» به کاربر نشان داده نمی‌شود. «پلن‌ها از محصولات HMPanel» را بزن.
            </p>
          )}
          {msg && (
            <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-[#1d6b41]' : 'text-[#d4373f]'}`}>
              {msg.text}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
