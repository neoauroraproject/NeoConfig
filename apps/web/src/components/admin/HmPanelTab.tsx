'use client';

import { Bot, Check, CreditCard, ExternalLink, Package, PlugZap, RefreshCw, ShoppingBag, Store, TriangleAlert, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { RenewalPlan } from '@/lib/api';
import { AdminBrand, HmOverview, HmProduct, adminApi } from './adminApi';
import { ProductPicker, productService } from './HmPanelRenewal';
import { Button, Card, StatusDot, Toggle, errMsg } from './ui';

const GB = 1024 ** 3;
const fa = (n: number) => n.toLocaleString('fa-IR');

type SetFn = <K extends keyof AdminBrand>(k: K, v: AdminBrand[K]) => void;
type PanelRow = { id: string; name: string; host: string; healthy: boolean | null; inBrand: boolean };

/**
 * Everything a brand takes from an HMPanel admin, in one place: the account and
 * store status, payment cards (live or copied), store products as plans, and
 * whether receipts go to the HMPanel store (its bot approves) or stay here.
 */
export function HmPanelTab({
  draft,
  set,
  isAdmin,
  goPanels,
}: {
  draft: AdminBrand;
  set: SetFn;
  isAdmin: boolean;
  goPanels: () => void;
}) {
  const [panels, setPanels] = useState<PanelRow[] | null>(null);
  const [data, setData] = useState<HmOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<HmProduct[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<'all' | 'xui' | 'pasarguard'>('all');
  const [msg, setMsg] = useState<string | null>(null);
  const panelId = draft.renewalPanelId ?? '';

  useEffect(() => {
    adminApi
      .hmpanelPanels(draft.id)
      .then(setPanels)
      .catch(() => setPanels([]));
  }, [draft.id]);

  const load = useCallback(() => {
    if (!panelId) return setData(null);
    setLoading(true);
    adminApi
      .hmpanelOverview(draft.id, panelId)
      .then(setData)
      .catch((e) => setMsg(errMsg(e)))
      .finally(() => setLoading(false));
  }, [draft.id, panelId]);
  useEffect(load, [load]);

  if (panels === null) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--surface)]" />;

  if (panels.length === 0) {
    return (
      <Card>
        <Head icon={<PlugZap className="h-5 w-5" />} title="اتصال به HMPanel" />
        <p className="mt-2 text-sm leading-7 text-[var(--ink-2)]">
          با وصل کردن HMPanel، کاربران از همان پنل پیدا می‌شوند، تمدید از اعتبار همان ادمین کم می‌شود و کارت‌ها، پلن‌ها، فروشگاه و ربات HMPanel اینجا در دسترس است.
        </p>
        <p className="mt-2 text-xs leading-6 text-[var(--ink-3)]">
          در HMPanel از «تنظیمات ← API» یک کلید با دسترسی کامل بساز، بعد در «اتصال پنل‌ها» پنل جدید از نوع HMPanel اضافه کن.
        </p>
        {isAdmin && (
          <Button className="mt-4" onClick={goPanels}>
            <PlugZap className="h-4 w-4" /> افزودن پنل HMPanel
          </Button>
        )}
      </Card>
    );
  }

  const current = panels.find((p) => p.id === panelId);
  const ok = <T,>(part: { ok: boolean; data?: T } | undefined) => (part?.ok ? (part.data as T) : null);
  const account = ok(data?.account);
  const premium = ok(data?.premium);
  const shop = ok(data?.store);
  const cards = ok(data?.cards) ?? [];
  const storeProducts = ok(data?.products) ?? [];
  const hasStore = Boolean(premium?.modules?.some((m) => m.id === 'store'));
  const linked = draft.plans.filter((p) => p.productId);

  function importPicked() {
    if (!products) return;
    const prevById = new Map(linked.map((p) => [p.productId, p]));
    const fromStore: RenewalPlan[] = products
      .filter((p) => picked.has(p.id))
      .slice(0, 12)
      .map((p) => {
        const prev = prevById.get(p.id);
        const service = productService(p);
        return {
          id: prev?.id ?? `p${p.id.slice(-10)}`,
          title: prev?.title ?? p.name.slice(0, 60),
          days: p.durationDays,
          gb: p.trafficBytes > 0 ? +(p.trafficBytes / GB).toFixed(2) : 0,
          price: p.priceToman ? `${fa(p.priceToman)} تومان` : prev?.price ?? '',
          users: p.ipLimitOptions?.[0] ?? prev?.users ?? 0,
          // Product traffic is added to what is left; unlimited products start a new unlimited period.
          mode: p.trafficBytes > 0 ? 'add' : 'reset',
          productId: p.id,
          ...(service ? { service } : {}),
          ...(p.category?.name ? { category: p.category.name.slice(0, 40) } : prev?.category ? { category: prev.category } : {}),
        };
      });
    set('plans', [...fromStore, ...draft.plans.filter((p) => !p.productId)].slice(0, 12));
    setProducts(null);
    setMsg(`${fa(fromStore.length)} پلن وارد شد؛ «ذخیره تغییرات» را بزن.`);
  }

  const checks: Array<[boolean, string]> = [
    [Boolean(account), 'کلید API کار می‌کند'],
    [hasStore, 'لایسنس پرمیوم و ماژول فروشگاه فعال است'],
    [Boolean(shop?.enabled), 'فروشگاه HMPanel روشن است'],
    [cards.length > 0, 'حداقل یک کارت در فروشگاه'],
    [linked.length > 0, 'پلن‌های متصل به محصولات فروشگاه'],
    [draft.renewalEnabled, 'تمدید برای این برند روشن است'],
  ];

  return (
    <div className="space-y-3">
      {/* connection */}
      <Card>
        <Head icon={<Store className="h-5 w-5" />} title="اتصال HMPanel" sub="کاربران، کارت‌ها، پلن‌ها و تأیید رسید از همین پنل" />
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-1.5 block text-[13px] text-[var(--ink-2)]">پنل</span>
            <select
              className="field"
              value={panelId}
              onChange={(e) => {
                set('renewalPanelId', e.target.value || null);
                if (!e.target.value) {
                  set('renewalVia', 'local');
                  set('cardFromPanel', false);
                  set('plansSync', false);
                }
              }}
            >
              <option value="">— استفاده نکن —</option>
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.host})
                </option>
              ))}
            </select>
          </label>
          {panelId && (
            <Button variant="secondary" onClick={load} busy={loading}>
              <RefreshCw className="h-4 w-4" /> به‌روزرسانی
            </Button>
          )}
        </div>
        {current && !current.inBrand && (
          <Warn>
            این برند فقط در پنل‌های انتخاب‌شده‌اش جست‌وجو می‌کند و «{current.name}» جزو آن‌ها نیست؛ کاربران HMPanel پیدا نمی‌شوند.
            {isAdmin && (
              <button
                type="button"
                className="ms-2 font-medium underline"
                onClick={() => set('panelIds', [...draft.panelIds, current.id])}
              >
                افزودن به پنل‌های برند
              </button>
            )}
          </Warn>
        )}
        {msg && <p className="mt-3 text-sm text-[var(--ink-2)]">{msg}</p>}
      </Card>

      {panelId && data && (
        <>
          {/* account + store status */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <Head icon={<Wallet className="h-5 w-5" />} title="حساب ادمین" />
              {account ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Stat label="کاربری" value={account.username} />
                  <Stat label="نقش" value={account.role === 'SUPER_ADMIN' ? 'سوپرادمین' : 'نماینده'} />
                  <Stat label="کاربران" value={account.clientCount != null ? fa(account.clientCount) + (account.maxClients ? ` / ${fa(account.maxClients)}` : '') : '—'} />
                  <Stat label="اعتبار" value={account.balance != null ? fa(account.balance) : account.unlimitedTraffic ? 'نامحدود' : '—'} />
                </dl>
              ) : (
                <Warn>{data.account.ok ? '' : data.account.error}</Warn>
              )}
              <p className="mt-3 text-xs leading-6 text-[var(--ink-3)]">تمدیدها از سهمیه و اعتبار همین ادمین کم می‌شود.</p>
            </Card>
            <Card>
              <Head icon={<Store className="h-5 w-5" />} title="فروشگاه" />
              {shop ? (
                <div className="mt-3 text-sm">
                  <p className="flex items-center gap-2">
                    <StatusDot ok={shop.enabled} /> {shop.title} {shop.enabled ? '' : '(خاموش)'}
                  </p>
                  {shop.storefrontUrl && (
                    <a href={shop.storefrontUrl} target="_blank" rel="noreferrer" dir="ltr" className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--brand)]">
                      {shop.storefrontUrl} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <p className="mt-2 text-xs text-[var(--ink-3)]">
                    {fa(storeProducts.length)} محصول قابل تمدید · {fa(cards.length)} کارت
                  </p>
                </div>
              ) : (
                <Warn>{data.store.ok ? '' : data.store.error}</Warn>
              )}
            </Card>
          </div>

          {/* receipts: where they are reviewed */}
          <Card>
            <Head icon={<Bot className="h-5 w-5" />} title="بررسی رسید و ربات" sub="رسید کاربر کجا تأیید شود؟" />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Choice
                on={draft.renewalVia === 'hmpanel'}
                onClick={() => set('renewalVia', 'hmpanel')}
                title="فروشگاه و ربات HMPanel"
                body="رسید به‌صورت سفارش تمدید در فروشگاه HMPanel ثبت می‌شود؛ ربات فروشگاه HMPanel آن را با دکمهٔ تأیید/رد برای ادمین می‌فرستد. با تأیید، HMPanel تمدید می‌کند و نتیجه اینجا و روی گوشی کاربر می‌آید. ربات جدا لازم نیست."
                disabled={!hasStore}
              />
              <Choice
                on={draft.renewalVia !== 'hmpanel'}
                onClick={() => set('renewalVia', 'local')}
                title="NeoConfig"
                body="رسید در صفحهٔ «تمدیدها» و ربات تلگرام خود برند (تب اعلان) بررسی می‌شود؛ تمدید خودکار باز هم روی HMPanel انجام می‌شود."
              />
            </div>
            {!hasStore && <Warn>برای حالت فروشگاه، لایسنس پرمیوم و ماژول «فروشگاه» برای این ادمین لازم است.{data.premium.ok ? '' : ` (${data.premium.error})`}</Warn>}
          </Card>

          {/* cards */}
          <Card>
            <Head icon={<CreditCard className="h-5 w-5" />} title="کارت پرداخت" sub="کارتی که کاربر برای کارت به کارت می‌بیند" />
            <div className="mt-3">
              <Toggle
                id="hm-card-live"
                label="همیشه کارت را از HMPanel بخوان (تغییرات آنجا خودکار اینجا هم اعمال می‌شود)"
                checked={draft.cardFromPanel}
                onChange={(v) => set('cardFromPanel', v)}
              />
            </div>
            {cards.length === 0 ? (
              <Warn>{data.cards.ok ? 'در فروشگاه HMPanel کارت فعالی نیست.' : data.cards.error}</Warn>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {cards.map((c, i) => {
                  const on = draft.cardFromPanel
                    ? (draft.hmCardId ? draft.hmCardId === c.id : i === 0)
                    : (draft.cardNumber ?? '').replace(/\D/g, '') === c.cardNumber.replace(/\D/g, '');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        set('hmCardId', c.id);
                        set('cardNumber', c.cardNumber.replace(/\D/g, ''));
                        set('cardHolder', c.cardHolder ?? '');
                        set('bankName', c.bankName ?? '');
                      }}
                      className={`relative rounded-2xl border p-4 text-start ${on ? 'border-[var(--ink)] bg-[var(--surface-2)]' : 'border-[var(--line)] hover:bg-[var(--surface-2)]'}`}
                    >
                      {on && <Check className="absolute end-3 top-3 h-4 w-4" />}
                      <span className="block text-xs text-[var(--ink-3)]">{c.bankName || 'کارت'}</span>
                      <span dir="ltr" className="num mt-1.5 block text-[15px]">
                        {c.cardNumber.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ')}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--ink-2)]">{c.cardHolder}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* plans */}
          <Card>
            <Head icon={<Package className="h-5 w-5" />} title="پلن‌ها از محصولات فروشگاه" sub={`${fa(linked.length)} پلن به محصولات HMPanel وصل است`} />
            <div className="mt-3">
              <Toggle
                id="hm-plans-sync"
                label="مدت، حجم و قیمت پلن‌های وصل‌شده همیشه از HMPanel به‌روز شود"
                checked={draft.plansSync}
                onChange={(v) => set('plansSync', v)}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={storeProducts.length === 0}
                onClick={() => {
                  setProducts(storeProducts);
                  const ids = new Set(linked.map((p) => p.productId));
                  setPicked(new Set(ids.size ? storeProducts.filter((p) => ids.has(p.id)).map((p) => p.id) : storeProducts.slice(0, 12).map((p) => p.id)));
                }}
              >
                <Package className="h-4 w-4" /> انتخاب محصولات ({fa(storeProducts.length)})
              </Button>
            </div>
            {!data.products.ok && <Warn>{data.products.error}</Warn>}
            {products && (
              <ProductPicker
                products={products}
                picked={picked}
                setPicked={setPicked}
                kind={kind}
                setKind={setKind}
                onImport={importPicked}
                onCancel={() => setProducts(null)}
              />
            )}
            {linked.length > 0 && !products && (
              <ul className="mt-3 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
                {linked.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    {p.category && <span className="text-xs text-[var(--ink-3)]">{p.category}</span>}
                    {p.service && <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[11px]">{p.service === 'xui' ? 'ثنایی' : 'پاسارگارد'}</span>}
                    <span className="text-xs">{p.price}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs leading-6 text-[var(--ink-3)]">جزئیات هر پلن (عنوان، نوع سرویس، دسته‌بندی) در تب «تمدید» قابل ویرایش است.</p>
          </Card>

          {/* new purchases */}
          <Card>
            <Head icon={<ShoppingBag className="h-5 w-5" />} title="خرید سرویس جدید در اپ" sub="مشتری از داخل اپ سرویس تازه می‌خرد" />
            <div className="mt-3">
              <Toggle
                id="hm-purchase"
                label="دکمهٔ «خرید سرویس جدید» در اپ کاربر نمایش داده شود"
                checked={draft.purchaseEnabled}
                onChange={(v) => set('purchaseEnabled', v)}
              />
            </div>
            <p className="mt-2 text-xs leading-6 text-[var(--ink-3)]">
              سفارش با همان پلن‌های متصل به محصولات و همان کارت، در فروشگاه HMPanel ثبت می‌شود و ربات HMPanel آن را برای تأیید می‌فرستد. بعد از تأیید، HMPanel سرویس را می‌سازد و لینکش خودکار به اپ همان مشتری اضافه می‌شود.
            </p>
            {draft.purchaseEnabled && !hasStore && <Warn>برای خرید جدید، ماژول فروشگاه HMPanel لازم است.</Warn>}
            {draft.purchaseEnabled && linked.length === 0 && <Warn>هنوز هیچ پلنی به محصولات فروشگاه وصل نیست.</Warn>}
          </Card>

          {/* readiness */}
          {draft.renewalVia === 'hmpanel' && (
            <Card>
              <Head icon={<Check className="h-5 w-5" />} title="آمادگی تمدید از فروشگاه HMPanel" />
              <ul className="mt-3 space-y-2">
                {checks.map(([pass, label]) => (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    <StatusDot ok={pass} /> <span className={pass ? '' : 'text-[var(--ink-2)]'}>{label}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Head({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--ink-2)]">{icon}</span>
      <div>
        <h2 className="font-medium">{title}</h2>
        {sub && <p className="text-xs text-[var(--ink-3)]">{sub}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
      <dt className="text-[11px] text-[var(--ink-3)]">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

function Choice({ on, onClick, title, body, disabled }: { on: boolean; onClick: () => void; title: string; body: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-start disabled:opacity-50 ${on ? 'border-[var(--ink)] bg-[var(--surface-2)]' : 'border-[var(--line)]'}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className={`grid h-4 w-4 place-items-center rounded-full border ${on ? 'border-[var(--ink)]' : 'border-[var(--line)]'}`}>
          {on && <span className="h-2 w-2 rounded-full bg-[var(--ink)]" />}
        </span>
        {title}
      </span>
      <span className="mt-1.5 block text-xs leading-6 text-[var(--ink-3)]">{body}</span>
    </button>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff7ec] px-3 py-2 text-xs leading-6 text-[#7a4a0b]">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
