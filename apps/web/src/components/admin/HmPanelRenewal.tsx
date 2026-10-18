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
  const [products, setProducts] = useState<HmProduct[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<'all' | 'xui' | 'pasarguard'>('all');
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

  async function loadProducts() {
    if (!panelId) return;
    setBusy('products');
    setMsg(null);
    try {
      const list = await adminApi.hmpanelProducts(draft.id, panelId);
      if (!list.length) {
        setMsg({ ok: false, text: 'محصول قابل تمدیدی در فروشگاه HMPanel نیست.' });
        return;
      }
      setProducts(list);
      const linked = new Set(draft.plans.map((p) => p.productId).filter(Boolean));
      setPicked(new Set(linked.size ? list.filter((p) => linked.has(p.id)).map((p) => p.id) : list.slice(0, 12).map((p) => p.id)));
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  function importPicked() {
    if (!products) return;
    const linked = new Map(draft.plans.filter((p) => p.productId).map((p) => [p.productId, p]));
    const chosen = products.filter((p) => picked.has(p.id));
    const fromStore: RenewalPlan[] = chosen.slice(0, 12).map((p) => {
      const prev = linked.get(p.id);
      const service = productService(p);
      return {
        id: prev?.id ?? `p${p.id.slice(-10)}`,
        title: prev?.title ?? p.name.slice(0, 60),
        days: p.durationDays,
        gb: p.trafficBytes > 0 ? +(p.trafficBytes / GB).toFixed(2) : 0,
        price: p.priceToman ? `${fa(p.priceToman)} تومان` : prev?.price ?? '',
        users: p.ipLimitOptions?.[0] ?? prev?.users ?? 0,
        mode: p.trafficBytes > 0 ? 'add' : 'reset',
        productId: p.id,
        ...(service ? { service } : {}),
        ...(p.category?.name ? { category: p.category.name.slice(0, 40) } : prev?.category ? { category: prev.category } : {}),
          ...(p.category?.id ? { categoryId: p.category.id } : {}),
          ...(p.panel?.id ? { sourcePanelId: p.panel.id, sourcePanelName: p.panel.name } : {}),
      };
    });
    const manual = draft.plans.filter((p) => !p.productId);
    set('plans', [...fromStore, ...manual].slice(0, 12));
    setProducts(null);
    setMsg({ ok: true, text: `${fa(fromStore.length)} پلن از فروشگاه HMPanel وارد شد. «ذخیره تغییرات» را بزن.` });
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
            <Button variant="secondary" onClick={loadProducts} disabled={busy !== null}>
              {busy === 'products' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} پلن‌ها از محصولات HMPanel
            </Button>
          </div>

          {products && (
            <ProductPicker
              products={products}
              picked={picked}
              setPicked={setPicked}
              kind={kindFilter}
              setKind={setKindFilter}
              onImport={importPicked}
              onCancel={() => setProducts(null)}
            />
          )}

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

export function productService(p: HmProduct): 'xui' | 'pasarguard' | undefined {
  const id = (p.providerId || '').toLowerCase();
  if (id.includes('pasarguard') || id.includes('marzban')) return 'pasarguard';
  if (id.includes('xui') || id.includes('3x')) return 'xui';
  return undefined;
}

const KIND_LABEL = { xui: 'ثنایی', pasarguard: 'پاسارگارد' } as const;

/** Choose which store products become plans, grouped by category and filterable by panel type. */
export function ProductPicker({
  products,
  picked,
  setPicked,
  kind,
  setKind,
  onImport,
  onCancel,
}: {
  products: HmProduct[];
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  kind: 'all' | 'xui' | 'pasarguard';
  setKind: (k: 'all' | 'xui' | 'pasarguard') => void;
  onImport: () => void;
  onCancel: () => void;
}) {
  const [cat, setCat] = useState<string>('all');
  const cats = [...new Map(products.filter((p) => p.category).map((p) => [p.category!.id, p.category!.name])).entries()];
  const visible = products.filter((p) => (kind === 'all' || productService(p) === kind) && (cat === 'all' || p.category?.id === cat));
  const groups = new Map<string, HmProduct[]>();
  for (const p of visible) {
    const key = p.category?.name || 'بدون دسته';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else if (next.size < 12) next.add(id);
    setPicked(next);
  };
  return (
    <div className="mt-4 rounded-2xl border border-[var(--line)] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(['all', 'xui', 'pasarguard'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`h-8 rounded-full px-3 text-xs ${kind === k ? 'bg-[var(--ink)] text-white' : 'border border-[var(--line)] text-[var(--ink-2)]'}`}
          >
            {k === 'all' ? 'همه' : KIND_LABEL[k]}
          </button>
        ))}
        <span className="ms-auto text-xs text-[var(--ink-3)]">{fa(picked.size)} انتخاب‌شده (حداکثر ۱۲)</span>
      </div>
      {cats.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[['all', 'همهٔ دسته‌ها'] as [string, string], ...cats].map(([id, name]) => (
            <button
              key={id}
              type="button"
              onClick={() => setCat(id)}
              aria-pressed={cat === id}
              className={`h-8 rounded-full px-3 text-xs ${cat === id ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)] text-[var(--ink-2)]'}`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {[...groups.entries()].map(([cat, items]) => (
          <div key={cat}>
            <p className="mb-1.5 text-xs font-medium text-[var(--ink-2)]">{cat}</p>
            <div className="space-y-1">
              {items.map((p) => {
                const svc = productService(p);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--surface-2)]">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block text-[11px] text-[var(--ink-3)]">
                        {p.durationDays ? `${fa(p.durationDays)} روز` : ''}
                        {p.trafficBytes ? ` · ${fa(+(p.trafficBytes / GB).toFixed(1))} گیگ` : ' · نامحدود'}
                        {p.panel?.name ? ` · ${p.panel.name}` : ''}
                      </span>
                    </span>
                    {svc && <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px] text-[var(--ink-2)]">{KIND_LABEL[svc]}</span>}
                    <span className="text-xs">{p.priceToman ? `${fa(p.priceToman)} ت` : '—'}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        {visible.length === 0 && <p className="py-4 text-center text-sm text-[var(--ink-3)]">محصولی با این فیلتر نیست.</p>}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          انصراف
        </Button>
        <Button onClick={onImport} disabled={picked.size === 0}>
          وارد کردن {fa(picked.size)} پلن
        </Button>
      </div>
    </div>
  );
}
