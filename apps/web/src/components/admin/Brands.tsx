'use client';

import { ChevronDown, ArrowRight, ExternalLink, Globe, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { THEME_IDS, type BrandCopy, type Branding, type ThemeId } from '@/lib/api';
import { DARK_THEMES, ICON_BACKGROUNDS, THEME_SWATCH } from '@/lib/themes';
import { relativeTime } from '@/lib/format';
import { AdminBrand, Member, Panel, adminApi } from './adminApi';
import { PhonePreview } from './PhonePreview';
import { HmPanelTab } from './HmPanelTab';
import { PlansEditor } from './PlansEditor';
import { PushLogCard } from './PushLogCard';
import { RemindersCard } from './RemindersCard';
import { Button, Card, Empty, Field, PageHeader, StatusDot, Toggle, errMsg } from './ui';

const THEMES = THEME_IDS.map((id) => ({ id, label: THEME_SWATCH[id].fa, ...THEME_SWATCH[id] }));

export function Brands({ isAdmin }: { isAdmin: boolean }) {
  const [brands, setBrands] = useState<AdminBrand[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => adminApi.brands().then(setBrands).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    void load();
  }, []);

  const open = brands?.find((b) => b.id === openId);
  if (open) {
    return (
      <BrandEditor
        key={open.id}
        brand={open}
        isAdmin={isAdmin}
        onBack={() => setOpenId(null)}
        onChange={(b) => setBrands((list) => list?.map((x) => (x.id === b.id ? b : x)) ?? null)}
        onDeleted={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="برندها"
        subtitle="هر برند یک اپ جدا با نام، رنگ، دامنه و پنل‌های خودش است."
        action={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> برند جدید
            </Button>
          )
        }
      />
      {error && <p className="mb-4 text-sm text-[#d4373f]">{error}</p>}
      {creating && (
        <NewBrand
          onCancel={() => setCreating(false)}
          onCreated={(b) => {
            setCreating(false);
            setBrands((l) => [...(l ?? []), b]);
            setOpenId(b.id);
          }}
        />
      )}
      {brands === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-[var(--surface)]" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <Empty title="برندی به شما سپرده نشده" body="مالک سیستم باید برندی را به حساب شما اختصاص دهد." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setOpenId(b.id)}
              className="group overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] text-start transition hover:border-[var(--ink-3)]"
            >
              <div className="relative h-24" style={{ background: THEMES.find((t) => t.id === b.theme)?.canvas }}>
                <div
                  className="absolute bottom-0 start-4 h-14 w-24 rounded-t-2xl"
                  style={{ background: b.primaryColor }}
                />
                <div className="absolute bottom-0 start-[7.5rem] h-10 w-10 rounded-t-full" style={{ background: b.accentColor }} />
                {!b.active && <span className="absolute end-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">غیرفعال</span>}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{b.appName}</p>
                  {b.isDefault && <span className="text-xs text-[var(--ink-3)]">پیش‌فرض</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--ink-3)]" dir="ltr" style={{ textAlign: 'right' }}>
                  {b.domains[0]?.domain ?? `/b/${b.slug}`}
                </p>
                <p className="mt-3 text-xs text-[var(--ink-2)]">
                  {b.pendingRenewals > 0 ? `${b.pendingRenewals} تمدید در انتظار · ` : ''}
                  {b.devices} دستگاه با اعلان
                  {b.owner ? ` · ${b.owner.name || b.owner.email}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NewBrand({ onCancel, onCreated }: { onCancel: () => void; onCreated: (b: AdminBrand) => void }) {
  const [appName, setAppName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await adminApi.createBrand({ appName: appName.trim(), shortName: appName.trim(), slug: slug.trim() }));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="نام برند" htmlFor="nb-name">
          <input id="nb-name" required className="field" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="مثلاً آرین‌نت" />
        </Field>
        <Field label="آدرس کوتاه" htmlFor="nb-slug" hint="حروف انگلیسی؛ اپ روی /b/آدرس هم در دسترس است">
          <input id="nb-slug" required dir="ltr" pattern="[a-zA-Z0-9-]+" className="field" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ariannet" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" busy={busy}>
            ساخت برند
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        </div>
        {error && <p className="text-sm text-[#d4373f] sm:col-span-3">{error}</p>}
      </form>
    </Card>
  );
}

type Tab = 'look' | 'domains' | 'renewal' | 'hmpanel' | 'access' | 'notify' | 'network';

function BrandEditor({
  brand,
  isAdmin,
  onBack,
  onChange,
  onDeleted,
}: {
  brand: AdminBrand;
  isAdmin: boolean;
  onBack: () => void;
  onChange: (b: AdminBrand) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<AdminBrand>(brand);
  const [tab, setTab] = useState<Tab>('look');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(brand);
  const set = <K extends keyof AdminBrand>(k: K, v: AdminBrand[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Partial<AdminBrand> = {
        appName: draft.appName,
        shortName: draft.shortName,
        tagline: draft.tagline ?? '',
        logoUrl: draft.logoUrl ?? '',
        iconUrl: draft.iconUrl ?? '',
        primaryColor: draft.primaryColor,
        accentColor: draft.accentColor,
        theme: draft.theme,
        themeChoices: draft.themeChoices ?? [],
        iconBg: draft.iconBg ?? 'theme',
        buttonColor: draft.buttonColor ?? null,
        copy: draft.copy ?? {},
        reminders: draft.reminders,
        renewalVia: draft.renewalVia ?? 'local',
        renewalPanelId: draft.renewalPanelId ?? null,
        cardFromPanel: draft.cardFromPanel ?? false,
        hmCardId: draft.hmCardId ?? null,
        plansSync: draft.plansSync ?? false,
        purchaseEnabled: draft.purchaseEnabled ?? false,
        purchaseVia: draft.purchaseVia ?? 'store',
        purchaseInbounds: draft.purchaseInbounds ?? [],
        uptimeUrl: draft.uptimeUrl ?? '',
        uptimeSlug: draft.uptimeSlug ?? '',
        ...(draft.uptimeKey !== undefined ? { uptimeKey: draft.uptimeKey } : {}),
        autoDecideMinutes: draft.autoDecideMinutes ?? 0,
        autoDecideAction: draft.autoDecideAction ?? 'approve',
        defaultLocale: draft.defaultLocale,
        supportUrl: draft.supportUrl ?? '',
        supportTelegram: draft.supportTelegram ?? '',
        contactEmail: draft.contactEmail ?? '',
        allowCopyLink: draft.allowCopyLink,
        renewalEnabled: draft.renewalEnabled,
        cardNumber: draft.cardNumber ?? '',
        cardHolder: draft.cardHolder ?? '',
        bankName: draft.bankName ?? '',
        renewalNote: draft.renewalNote ?? '',
        plans: draft.plans,
        expiryRemindersEnabled: draft.expiryRemindersEnabled,
      };
      if (isAdmin) {
        Object.assign(body, {
          slug: draft.slug,
          active: draft.active,
          panelIds: draft.panelIds,
          ownerId: draft.owner?.id ?? null,
          strictLookup: Boolean(draft.strictLookup),
          ...(draft.isDefault && !brand.isDefault ? { isDefault: true } : {}),
        });
      }
      const next = await adminApi.updateBrand(brand.id, body);
      onChange(next);
      setDraft(next);
      setSaved(true);
    } catch (e) {
      setError(friendlySaveError(errMsg(e)));
    } finally {
      setSaving(false);
    }
  }

  const preview: Branding = useMemo(
    () => ({
      slug: draft.slug,
      appName: draft.appName,
      shortName: draft.shortName,
      tagline: draft.tagline,
      logoUrl: draft.logoUrl || null,
      logoDarkUrl: draft.logoDarkUrl || null,
      copy: draft.copy ?? {},
      iconUrl: draft.iconUrl || null,
      primaryColor: draft.primaryColor,
      accentColor: draft.accentColor,
      theme: draft.theme,
      themes: [draft.theme, ...(draft.themeChoices ?? []).filter((t) => t !== draft.theme)],
      iconBg: draft.iconBg,
      buttonColor: draft.buttonColor,
      defaultLocale: draft.defaultLocale,
      supportUrl: draft.supportUrl,
      supportTelegram: draft.supportTelegram,
      contactEmail: draft.contactEmail,
      allowCopyLink: draft.allowCopyLink,
      renewal:
        draft.renewalEnabled && draft.cardNumber && draft.plans.length
          ? { cardNumber: draft.cardNumber, cardHolder: draft.cardHolder, bankName: draft.bankName, note: draft.renewalNote, plans: draft.plans }
          : null,
    }),
    [draft],
  );

  const tabs: Array<[Tab, string]> = [
    ['look', 'ظاهر'],
    ['domains', 'دامنه'],
    ['renewal', 'تمدید'],
    ['hmpanel', 'HMPanel'],
    ...(isAdmin ? ([['access', 'پنل و نماینده']] as Array<[Tab, string]>) : []),
    ['notify', 'اعلان'],
    ['network', 'وضعیت شبکه'],
  ];
  const liveUrl = brand.domains.find((d) => d.sslOk)?.domain
    ? `https://${brand.domains.find((d) => d.sslOk)!.domain}`
    : `/b/${brand.slug}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} aria-label="بازگشت به برندها" className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--line)] bg-[var(--surface)]">
          <ArrowRight className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{draft.appName}</h1>
          <a href={liveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--brand)]" dir="ltr">
            {liveUrl} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        {saved && !dirty && <span className="text-sm text-[#1fa66a]">ذخیره شد</span>}
        <Button onClick={save} busy={saving} disabled={!dirty}>
          ذخیره تغییرات
        </Button>
      </div>
      {error && <p className="mb-4 text-sm text-[#d4373f]">{error}</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="scrollbar-none mb-4 flex gap-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1" role="tablist">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`h-9 shrink-0 rounded-lg px-4 text-sm ${tab === id ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'look' && (
            <LookTab
              draft={draft}
              set={set}
              brandId={brand.id}
              onLogo={(b) => {
                onChange(b);
                setDraft((d) => ({ ...d, logoUrl: b.logoUrl, logoDarkUrl: b.logoDarkUrl }));
              }}
            />
          )}
          {tab === 'domains' && <DomainsTab brand={brand} draft={draft} set={set} isAdmin={isAdmin} onChange={(b) => { onChange(b); setDraft((d) => ({ ...d, domains: b.domains })); }} />}
          {tab === 'renewal' && <RenewalTab draft={draft} set={set} openHm={() => setTab('hmpanel')} />}
          {tab === 'hmpanel' && (
            <HmPanelTab
              draft={draft}
              set={set}
              isAdmin={isAdmin}
              goPanels={() => {
                window.location.hash = 'panels';
                window.location.reload();
              }}
            />
          )}
          {tab === 'access' && isAdmin && <AccessTab draft={draft} set={set} onDeleted={onDeleted} />}
          {tab === 'network' && <NetworkTab draft={draft} set={set} />}
          {tab === 'notify' && (
            <>
              <TelegramCard
                brand={brand}
                onSaved={(b) => {
                  onChange(b);
                  setDraft((d) => ({ ...d, telegramChatId: b.telegramChatId, telegramConfigured: b.telegramConfigured }));
                }}
              />
              <NotifyTab brand={brand} draft={draft} set={set} />
            </>
          )}
        </div>

        <div className="xl:sticky xl:top-8 xl:self-start">
          <PhonePreview brand={preview} />
          <p className="mt-3 text-center text-xs text-[var(--ink-3)]">پیش‌نمایش زنده — تغییرات تا ذخیره نشوند برای کاربران اعمال نمی‌شوند.</p>
        </div>
      </div>
    </div>
  );
}

/** Validation messages come from the API in English; say what to fix instead. */
function friendlySaveError(msg: string) {
  if (/plans\.\d+\.(days|gb)/.test(msg)) return 'در پلن‌ها، «روز» و «گیگ» باید عدد باشند.';
  if (/plans\.\d+\.title/.test(msg)) return 'هر پلن عنوان لازم دارد.';
  if (/plans\.\d+\.price/.test(msg)) return 'هر پلن قیمت لازم دارد.';
  if (/address is already in use|slug/i.test(msg)) return 'این آدرس کوتاه قبلاً استفاده شده است.';
  if (/Telegram bot token/i.test(msg)) return 'توکن ربات تلگرام درست نیست؛ از @BotFather کپی کنید.';
  return `ذخیره نشد: ${msg}`;
}

type SetFn = <K extends keyof AdminBrand>(k: K, v: AdminBrand[K]) => void;

function LookTab({ draft, set, brandId, onLogo }: { draft: AdminBrand; set: SetFn; brandId: string; onLogo: (b: AdminBrand) => void }) {
  return (
    <div className="space-y-3">
      <Card>
        <h2 className="mb-4 font-medium">هویت</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام اپ" htmlFor="b-name">
            <input id="b-name" className="field" value={draft.appName} onChange={(e) => set('appName', e.target.value)} />
          </Field>
          <Field label="نام کوتاه" htmlFor="b-short" hint="زیر آیکون روی صفحهٔ گوشی">
            <input id="b-short" className="field" maxLength={14} value={draft.shortName} onChange={(e) => set('shortName', e.target.value)} />
          </Field>
          <Field label="جملهٔ بالای صفحهٔ ورود" htmlFor="b-tag" hint="خالی بماند: «وضعیت سرویس، همیشه دم دست»">
            <input id="b-tag" className="field" value={draft.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <LogoField
            brandId={brandId}
            variant="light"
            label="لوگو برای پوستهٔ روشن (مه)"
            hint="لوگوی تیره یا رنگی که روی زمینهٔ روشن خوانا باشد."
            value={draft.logoUrl}
            onSaved={onLogo}
          />
          <LogoField
            brandId={brandId}
            variant="dark"
            label="لوگو برای پوسته‌های تیره"
            hint="لوگوی روشن/سفید برای گرافیت، مریم‌گلی، خزه، مروارید و صفحهٔ معرفی. خالی بماند، همان لوگوی اول استفاده می‌شود."
            value={draft.logoDarkUrl}
            onSaved={onLogo}
          />
        </div>
      </Card>
      <CopyCard draft={draft} set={set} />
      <Card>
        <h2 className="mb-4 font-medium">رنگ و پوسته</h2>
        <p className="mb-2 text-xs text-[var(--ink-2)]">پوستهٔ پیش‌فرض</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5" role="radiogroup" aria-label="پوسته">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={draft.theme === t.id}
              onClick={() => set('theme', t.id)}
              className={`overflow-hidden rounded-xl border-2 text-start ${draft.theme === t.id ? 'border-[var(--ink)]' : 'border-transparent'}`}
            >
              <div className="flex h-16 items-end gap-1.5 p-2" style={{ background: t.canvas }}>
                <span className="h-10 flex-1 rounded-lg" style={{ background: t.card, boxShadow: '0 0 0 1px rgba(127,127,127,.2) inset' }} />
                <span className="h-7 w-7 rounded-lg" style={{ background: t.id === 'moss' || t.id === 'pearl' ? t.hi : draft.primaryColor }} />
              </div>
              <p className="bg-[var(--surface-2)] px-3 py-2 text-xs">{t.label}</p>
            </button>
          ))}
        </div>
        <p className="mb-2 mt-5 text-xs text-[var(--ink-2)]">پوسته‌هایی که کاربر از منوی اپ می‌تواند عوض کند</p>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => {
            const isDefault = draft.theme === t.id;
            const on = isDefault || (draft.themeChoices ?? []).includes(t.id);
            return (
              <label
                key={t.id}
                className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs ${on ? 'border-[var(--ink)]' : 'border-[var(--line)] text-[var(--ink-2)]'} ${isDefault ? 'opacity-70' : ''}`}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--ink)]"
                  checked={on}
                  disabled={isDefault}
                  onChange={(e) => {
                    const cur = (draft.themeChoices ?? []).filter((x) => x !== t.id);
                    set('themeChoices', (e.target.checked ? [...cur, t.id] : cur) as ThemeId[]);
                  }}
                />
                {t.label}
                {isDefault && <span className="text-[10px]">(پیش‌فرض)</span>}
              </label>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ColorField id="b-primary" label="رنگ اصلی" hint="کاشی روزها، دکمه‌ها" value={draft.primaryColor} onChange={(v) => set('primaryColor', v)} />
          <ColorField id="b-accent" label="رنگ تأکید" hint="دکمهٔ افزودن و نمودار امروز" value={draft.accentColor} onChange={(v) => set('accentColor', v)} />
          <div>
            <ColorField
              id="b-button"
              label="رنگ دکمه‌ها"
              hint="دکمه‌های اصلی (ادامه، ارسال رسید، افزودن…)؛ متن دکمه خودکار سفید یا تیره می‌شود"
              value={draft.buttonColor || draft.primaryColor}
              onChange={(v) => set('buttonColor', v)}
            />
            {draft.buttonColor && (
              <button type="button" onClick={() => set('buttonColor', null)} className="mt-1 text-xs text-[var(--brand)]">
                برگرداندن به رنگ اصلی
              </button>
            )}
          </div>
        </div>
      </Card>
      <IconBgCard draft={draft} set={set} />
      <Card>
        <h2 className="mb-4 font-medium">پشتیبانی و رفتار</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="آیدی تلگرام پشتیبانی" htmlFor="b-tg">
            <input id="b-tg" dir="ltr" className="field" value={draft.supportTelegram ?? ''} onChange={(e) => set('supportTelegram', e.target.value)} placeholder="@support" />
          </Field>
          <Field label="لینک پشتیبانی دیگر" htmlFor="b-sup">
            <input id="b-sup" dir="ltr" className="field" value={draft.supportUrl ?? ''} onChange={(e) => set('supportUrl', e.target.value)} placeholder="https://" />
          </Field>
          <Field label="زبان پیش‌فرض" htmlFor="b-loc">
            <select id="b-loc" className="field" value={draft.defaultLocale} onChange={(e) => set('defaultLocale', e.target.value)}>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Toggle id="b-copy" label="کاربر بتواند لینک اشتراک را کپی کند" checked={draft.allowCopyLink} onChange={(v) => set('allowCopyLink', v)} />
        </div>
      </Card>
    </div>
  );
}

/** Uploads immediately (resized to 256px) — the logo is not part of the draft save. */
function LogoField({
  brandId,
  value,
  onSaved,
  variant,
  label,
  hint,
}: {
  brandId: string;
  value: string | null;
  onSaved: (b: AdminBrand) => void;
  variant: 'light' | 'dark';
  label: string;
  hint: string;
}) {
  const inputId = `b-logo-${variant}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const size = 256;
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      onSaved(await adminApi.uploadLogo(brandId, canvas.toDataURL('image/png'), variant));
    } catch (e) {
      setError(e instanceof Error && e.message !== 'network' ? errMsg(e) : 'این فایل تصویر قابل خواندن نیست');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error}>
      <div className="flex items-center gap-3">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[var(--line)]"
          style={{ background: variant === 'dark' ? '#1a1b1f' : '#f1f2f7' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {value ? <img src={value} alt="لوگوی فعلی" className="h-full w-full object-cover" /> : <span className="text-xs text-[var(--ink-3)]">ندارد</span>}
        </span>
        <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <label htmlFor={inputId} className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm">
          {busy ? 'در حال آپلود…' : value ? 'تغییر لوگو' : 'آپلود لوگو'}
        </label>
        {value && !busy && (
          <Button variant="ghost" onClick={async () => onSaved(await adminApi.removeLogo(brandId, variant))}>
            حذف
          </Button>
        )}
      </div>
    </Field>
  );
}

const COPY_FIELDS: Array<{ group: string; fields: Array<{ key: keyof BrandCopy; label: string; def: string; long?: boolean }> }> = [
  {
    group: 'صفحهٔ ورود (افزودن اشتراک)',
    fields: [
      { key: 'onboardTitle', label: 'عنوان', def: 'اشتراکت را / یک‌جا ببین', long: true },
      { key: 'onboardBody', label: 'توضیح', def: 'لینک اشتراک را بچسبان تا حجم باقی‌مانده، روزهای مانده و وضعیت اتصال را ببینی.', long: true },
    ],
  },
  {
    group: 'معرفی — مرحلهٔ خوش‌آمد',
    fields: [
      { key: 'introWelcomeA', label: 'خط اول عنوان', def: 'وضعیت سرویس،' },
      { key: 'introWelcomeB', label: 'خط دوم (رنگی)', def: 'همیشه دم دستت' },
      { key: 'introWelcomeBody', label: 'توضیح', def: 'حجم باقی‌مانده، روزهای مانده و اتصال را یک‌جا ببین و با یک لمس تمدید کن.', long: true },
    ],
  },
  {
    group: 'معرفی — نصب روی صفحهٔ اصلی',
    fields: [
      { key: 'introInstallA', label: 'خط اول عنوان', def: 'نصب روی' },
      { key: 'introInstallB', label: 'خط دوم (رنگی)', def: 'صفحهٔ اصلی' },
      { key: 'introInstallBody', label: 'توضیح', def: 'مثل یک اپلیکیشن واقعی باز می‌شود، سریع‌تر است و اعلان‌ها کامل کار می‌کنند.', long: true },
    ],
  },
  {
    group: 'معرفی — اعلان‌ها',
    fields: [
      { key: 'introNotifyA', label: 'خط اول عنوان', def: 'قبل از تمام شدن،' },
      { key: 'introNotifyB', label: 'خط دوم (رنگی)', def: 'خبرت می‌کنیم' },
      { key: 'introNotifyBody', label: 'توضیح', def: 'وقتی حجم یا زمان رو به پایان باشد یا تمدیدت انجام شود، اعلان می‌گیری؛ حتی وقتی اپ بسته است.', long: true },
    ],
  },
];

/** The brand's own wording for the first screen and the intro; empty fields keep the default text. */
function CopyCard({ draft, set }: { draft: AdminBrand; set: SetFn }) {
  const copy = draft.copy ?? {};
  const update = (key: keyof BrandCopy, value: string) => set('copy', { ...copy, [key]: value });
  return (
    <Card>
      <h2 className="font-medium">متن‌های صفحهٔ اول و معرفی</h2>
      <p className="mt-1 text-xs leading-6 text-[var(--ink-3)]">
        هر فیلد خالی بماند، متن پیش‌فرض (که کم‌رنگ نوشته شده) نمایش داده می‌شود. برای عنوان صفحهٔ ورود، خط دوم را بعد از Enter بنویس. این متن‌ها برای زبان پیش‌فرض برند اعمال می‌شوند.
      </p>
      <div className="mt-4 space-y-2">
        {COPY_FIELDS.map((g) => (
          <details key={g.group} className="group rounded-xl border border-[var(--line)] open:bg-[var(--surface-2)]">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
              <span className="flex-1 font-medium">{g.group}</span>
              <span className="text-xs text-[var(--ink-3)]">
                {g.fields.filter((f) => copy[f.key]?.trim()).length ? `${g.fields.filter((f) => copy[f.key]?.trim()).length} تغییر` : 'پیش‌فرض'}
              </span>
              <ChevronDown className="h-4 w-4 text-[var(--ink-3)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
              {g.fields.map((f) => (
                <label key={f.key} className={`block ${f.long ? 'sm:col-span-2' : ''}`}>
                  <span className="mb-1 block text-xs text-[var(--ink-3)]">{f.label}</span>
                  {f.long ? (
                    <textarea
                      className="field min-h-[4.5rem] resize-y"
                      rows={2}
                      maxLength={f.key.endsWith('Body') ? 240 : 60}
                      value={copy[f.key] ?? ''}
                      placeholder={f.def.replace(' / ', '\n')}
                      onChange={(e) => update(f.key, e.target.value)}
                    />
                  ) : (
                    <input className="field" maxLength={60} value={copy[f.key] ?? ''} placeholder={f.def} onChange={(e) => update(f.key, e.target.value)} />
                  )}
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

/** The home-screen icon (Android & iPhone): the logo on a chosen background. */
function IconBgCard({ draft, set }: { draft: AdminBrand; set: SetFn }) {
  const current = draft.iconBg || 'theme';
  return (
    <Card>
      <h2 className="font-medium">پس‌زمینهٔ آیکون برنامه</h2>
      <p className="mt-1 text-xs leading-6 text-[var(--ink-3)]">
        آیکونی که روی صفحهٔ گوشی (اندروید و آیفون) و تب مرورگر می‌نشیند. روی زمینه‌های تیره لوگوی روشن و روی روشن‌ها لوگوی تیره گذاشته می‌شود.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6" role="radiogroup" aria-label="پس‌زمینهٔ آیکون">
        {Object.entries(ICON_BACKGROUNDS).map(([id, bg]) => {
          const paint = id === 'theme' ? THEME_SWATCH[draft.theme].canvas : id === 'brand' ? draft.primaryColor : bg.css;
          const dark = id === 'theme' ? DARK_THEMES.has(draft.theme) : bg.dark;
          const logo = dark ? draft.logoDarkUrl || draft.logoUrl : draft.logoUrl || draft.logoDarkUrl;
          const on = current === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set('iconBg', id)}
              className="flex flex-col items-center gap-1.5"
            >
              <span
                className={`grid h-14 w-14 place-items-center overflow-hidden rounded-[1.1rem] shadow-sm ring-offset-2 ring-offset-[var(--surface)] ${on ? 'ring-2 ring-[var(--ink)]' : 'ring-1 ring-[var(--line)]'}`}
                style={{ background: paint }}
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="h-[78%] w-[78%] object-contain" />
                ) : (
                  <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden>
                    <circle cx="20" cy="20" r="18" fill="none" stroke={dark ? '#fff' : draft.primaryColor} strokeWidth="2.6" />
                    <circle cx="20" cy="26.5" r="6.5" fill={dark ? '#fff' : draft.primaryColor} />
                  </svg>
                )}
              </span>
              <span className={`text-[11px] ${on ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink-3)]'}`}>{bg.fa}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-[var(--ink-3)]">بعد از ذخیره، روی گوشی‌هایی که قبلاً نصب کرده‌اند آیکون با نصب دوباره (یا گاهی خودکار) عوض می‌شود.</p>
    </Card>
  );
}

function ColorField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-[42px] w-14 cursor-pointer rounded-xl border border-[var(--line)] bg-transparent p-1" />
        <input id={id} dir="ltr" className="field" value={value} onChange={(e) => onChange(e.target.value)} pattern="#[0-9a-fA-F]{6}" />
      </div>
    </Field>
  );
}

function DomainsTab({
  brand,
  draft,
  set,
  isAdmin,
  onChange,
}: {
  brand: AdminBrand;
  draft: AdminBrand;
  set: SetFn;
  isAdmin: boolean;
  onChange: (b: AdminBrand) => void;
}) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<AdminBrand>) {
    setBusy(key);
    setError(null);
    try {
      onChange(await fn());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <h2 className="font-medium">دامنه‌های اختصاصی</h2>
        <p className="mt-1 text-sm leading-7 text-[var(--ink-2)]">
          رکورد A دامنه را به IP همین سرور بزن و دامنه را اینجا اضافه کن. گواهی SSL از Let's Encrypt خودکار گرفته می‌شود (حدود یک دقیقه بعد از درست شدن DNS)؛ وضعیتش را با «بررسی» ببین.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (domain.trim()) void run('add', () => adminApi.addDomain(brand.id, domain.trim())).then(() => setDomain(''));
          }}
        >
          <label htmlFor="d-new" className="sr-only">
            دامنه
          </label>
          <input id="d-new" dir="ltr" className="field" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="app.example.com" />
          <Button type="submit" busy={busy === 'add'} className="shrink-0">
            <Globe className="h-4 w-4" /> افزودن
          </Button>
        </form>
        {error && <p className="mt-3 text-sm text-[#d4373f]">{error}</p>}
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {brand.domains.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
              <StatusDot ok={d.sslOk ?? d.dnsOk} />
              <div className="min-w-0 flex-1">
                <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" dir="ltr" className="text-sm font-medium">
                  {d.domain}
                </a>
                <p className="text-xs text-[var(--ink-3)]">
                  {d.checkMessage ? `${d.checkMessage}${d.lastCheckAt ? ` · ${relativeTime(d.lastCheckAt, 'fa')}` : ''}` : 'هنوز بررسی نشده'}
                </p>
              </div>
              <Button variant="secondary" busy={busy === d.id} onClick={() => run(d.id, () => adminApi.checkDomain(brand.id, d.id))}>
                <RefreshCw className="h-4 w-4" /> بررسی
              </Button>
              {d.dnsOk && !d.sslOk && (
                <Button variant="secondary" busy={busy === `ssl-${d.id}`} onClick={() => run(`ssl-${d.id}`, () => adminApi.issueSsl(brand.id, d.id))}>
                  <ShieldCheck className="h-4 w-4" /> صدور گواهی
                </Button>
              )}
              <Button variant="ghost" aria-label={`حذف ${d.domain}`} className="!px-3" onClick={() => run(`rm-${d.id}`, () => adminApi.removeDomain(brand.id, d.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
          {brand.domains.length === 0 && <li className="py-3 text-sm text-[var(--ink-3)]">هنوز دامنه‌ای وصل نشده.</li>}
        </ul>
      </Card>
      <Card>
        <h2 className="font-medium">آدرس بدون دامنه</h2>
        <p className="mt-1 text-sm text-[var(--ink-2)]">تا وقتی دامنه آماده نیست، اپ این برند از این مسیر باز می‌شود.</p>
        <div className="mt-3 flex items-center gap-2" dir="ltr">
          <span className="text-sm text-[var(--ink-3)]">/b/</span>
          <label htmlFor="b-slug" className="sr-only">
            آدرس کوتاه
          </label>
          <input id="b-slug" className="field max-w-xs" disabled={!isAdmin} value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} />
        </div>
      </Card>
    </div>
  );
}

function RenewalTab({ draft, set, openHm }: { draft: AdminBrand; set: SetFn; openHm: () => void }) {
  const plans = draft.plans;
  const [panels, setPanels] = useState<Array<{ id: string; name: string; type: string }>>([]);
  useEffect(() => {
    adminApi
      .brandPanels(draft.id)
      .then(setPanels)
      .catch(() => setPanels([]));
  }, [draft.id]);
  const usable = plans.filter((p) => p.title.trim() && p.price.trim());
  const missing = [
    !draft.renewalEnabled && 'روشن کردن تمدید',
    !(draft.cardFromPanel && draft.renewalPanelId) && !(draft.cardNumber && draft.cardNumber.replace(/\D/g, '').length >= 16) && 'شماره کارت ۱۶ رقمی',
    usable.length === 0 && 'حداقل یک پلن با عنوان و قیمت',
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-3">
      <div
        className={`rounded-2xl border px-4 py-3 text-sm ${missing.length ? 'border-[#f2c48d] bg-[#fff7ec] text-[#7a4a0b]' : 'border-[#bfe7cf] bg-[#effaf3] text-[#1d6b41]'}`}
        role="status"
      >
        {missing.length
          ? `دکمهٔ «تمدید» در اپ کاربر هنوز نمایش داده نمی‌شود. لازم است: ${missing.join('، ')} — و بعد «ذخیره تغییرات».`
          : 'دکمهٔ «تمدید» در اپ کاربر نمایش داده می‌شود (بعد از ذخیره).'}
      </div>
      <Card>
        <Toggle id="r-on" label="تمدید با کارت به کارت در اپ کاربر" checked={draft.renewalEnabled} onChange={(v) => set('renewalEnabled', v)} />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="شماره کارت" htmlFor="r-card">
            <input id="r-card" dir="ltr" inputMode="numeric" className="field num" disabled={draft.cardFromPanel && Boolean(draft.renewalPanelId)} value={draft.cardNumber ?? ''} onChange={(e) => set('cardNumber', e.target.value.replace(/[^\d ]/g, ''))} placeholder="6037 ...." />
          </Field>
          <Field label="به نام" htmlFor="r-holder">
            <input id="r-holder" className="field" value={draft.cardHolder ?? ''} onChange={(e) => set('cardHolder', e.target.value)} />
          </Field>
          <Field label="بانک" htmlFor="r-bank">
            <input id="r-bank" className="field" value={draft.bankName ?? ''} onChange={(e) => set('bankName', e.target.value)} />
          </Field>
          <Field label="توضیح زیر کارت" htmlFor="r-note" hint="مثلاً ساعت بررسی رسیدها">
            <input id="r-note" className="field" value={draft.renewalNote ?? ''} onChange={(e) => set('renewalNote', e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card>
        <Toggle
          id="r-auto"
          label="تصمیم خودکار اگر کسی رسید را بررسی نکرد"
          checked={(draft.autoDecideMinutes ?? 0) > 0}
          onChange={(v) => set('autoDecideMinutes', v ? 10 : 0)}
        />
        {(draft.autoDecideMinutes ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span>بعد از</span>
            <input
              type="number"
              min={1}
              max={10080}
              dir="ltr"
              aria-label="دقیقه"
              className="field !w-24 text-center"
              value={draft.autoDecideMinutes}
              onChange={(e) => set('autoDecideMinutes', Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
            <span>دقیقه،</span>
            <select
              aria-label="تصمیم"
              className="field !w-auto"
              value={draft.autoDecideAction ?? 'approve'}
              onChange={(e) => set('autoDecideAction', e.target.value as 'approve' | 'reject')}
            >
              <option value="approve">تأیید و تمدید خودکار</option>
              <option value="reject">رد خودکار</option>
            </select>
            <span>انجام شود.</span>
          </div>
        )}
        <p className="mt-2 text-xs leading-6 text-[var(--ink-3)]">
          رسیدهایی که در این مدت تأیید یا رد نشوند، خودکار تصمیم می‌گیرند و در «تمدیدها» و داشبورد با برچسب «خودکار» دیده می‌شوند؛ ربات هم خبر می‌دهد. اگر پنل تمدید را نپذیرد، رسید برای بررسی دستی می‌ماند. سفارش‌های فروشگاه HMPanel از تأیید خودکار خود HMPanel پیروی می‌کنند.
        </p>
      </Card>
      <button
        type="button"
        onClick={openHm}
        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-start text-sm hover:bg-[var(--surface-2)]"
      >
        <span className="flex-1">
          {draft.renewalPanelId
            ? draft.renewalVia === 'hmpanel'
              ? 'رسیدها به فروشگاه و ربات HMPanel می‌روند'
              : 'HMPanel وصل است؛ کارت‌ها و پلن‌ها را از آنجا بگیر'
            : 'HMPanel داری؟ کارت‌ها، پلن‌ها، فروشگاه و ربات را از آنجا وصل کن'}
        </span>
        <span className="text-[var(--brand)]">تب HMPanel ←</span>
      </button>
      <PlansEditor plans={plans} onChange={(next) => set('plans', next)} panels={panels} />
    </div>
  );
}

function AccessTab({ draft, set, onDeleted }: { draft: AdminBrand; set: SetFn; onDeleted: () => void }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.panels().then(setPanels).catch(() => undefined);
    adminApi.team().then(setTeam).catch(() => undefined);
  }, []);

  const resellers = team.filter((m) => m.role === 'RESELLER');
  return (
    <div className="space-y-3">
      <Card>
        <h2 className="font-medium">پنل‌های این برند</h2>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          اگر هیچ‌کدام انتخاب نشود، در همهٔ پنل‌ها جست‌وجو می‌شود — به‌جز برند نماینده، که فقط در پنل‌های انتخاب‌شده می‌گردد. برای برند نماینده، اتصال HMPanel با کلید خود همان نماینده را انتخاب کن تا تمدیدها از سهمیهٔ خودش کم شود.
        </p>
        <div className="mt-3 space-y-1">
          {panels.map((p) => (
            <label key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface-2)]">
              <input
                type="checkbox"
                checked={draft.panelIds.includes(p.id)}
                onChange={(e) => set('panelIds', e.target.checked ? [...draft.panelIds, p.id] : draft.panelIds.filter((x) => x !== p.id))}
              />
              <StatusDot ok={p.lastTestOk} />
              <span className="text-sm">{p.name}</span>
              <span className="text-xs text-[var(--ink-3)]">{p.type === 'pasarguard' ? 'PasarGuard' : p.type === 'hmpanel' ? 'HMPanel' : '3x-ui'}</span>
            </label>
          ))}
          {panels.length === 0 && <p className="text-sm text-[var(--ink-3)]">پنلی وصل نیست.</p>}
        </div>
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <Toggle
            id="b-strict"
            label="فقط اشتراک‌هایی که در پنل‌های همین برند هستند اضافه شوند"
            checked={Boolean(draft.strictLookup)}
            onChange={(v) => set('strictLookup', v)}
          />
          <p className="mt-1 text-xs leading-6 text-[var(--ink-3)]">
            لینکی که در این پنل‌ها نیست رد می‌شود (از خود لینک خوانده نمی‌شود). برای برندی که نماینده دارد همیشه روشن است.
          </p>
        </div>
      </Card>
      <Card>
        <h2 className="font-medium">نماینده فروش</h2>
        <p className="mt-1 text-sm text-[var(--ink-2)]">نماینده فقط همین برند را می‌بیند: ظاهر، کارت، پلن‌ها و رسیدها. به پنل‌ها دسترسی ندارد.</p>
        <label htmlFor="b-owner" className="sr-only">
          نماینده
        </label>
        <select
          id="b-owner"
          className="field mt-3 max-w-sm"
          value={draft.owner?.id ?? ''}
          onChange={(e) => {
            const m = resellers.find((r) => r.id === e.target.value);
            set('owner', m ? { id: m.id, email: m.email, name: m.name } : null);
          }}
        >
          <option value="">بدون نماینده (فقط مدیران)</option>
          {resellers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
        </select>
      </Card>
      <Card>
        <Toggle id="b-active" label="برند فعال است" checked={draft.active} onChange={(v) => set('active', v)} />
        <Toggle id="b-default" label="برند پیش‌فرض (برای دامنه‌های ناشناخته)" checked={draft.isDefault} onChange={(v) => set('isDefault', v)} />
        <div className="mt-4 border-t border-[var(--line)] pt-4">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm">برند، دامنه‌ها و درخواست‌های تمدیدش حذف می‌شوند.</p>
              <Button
                variant="danger"
                onClick={() =>
                  adminApi
                    .deleteBrand(draft.id)
                    .then(onDeleted)
                    .catch((e) => setError(errMsg(e)))
                }
              >
                حذف «{draft.appName}»
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                انصراف
              </Button>
            </div>
          ) : (
            <Button variant="ghost" className="!text-[#d4373f]" onClick={() => setConfirm(true)}>
              <Trash2 className="h-4 w-4" /> حذف برند
            </Button>
          )}
          {error && <p className="mt-2 text-sm text-[#d4373f]">{error}</p>}
        </div>
      </Card>
    </div>
  );
}

/** Bot token is write-only, so this card saves on its own instead of with the main form. */
/** A Cloudflare Worker that forwards Bot API calls to Telegram (for servers where it is filtered). */
const WORKER_SNIPPET = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'api.telegram.org';
    return fetch(new Request(url, request));
  },
};`;

function TelegramCard({ brand, onSaved }: { brand: AdminBrand; onSaved: (b: AdminBrand) => void }) {
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState(brand.telegramChatId ?? '');
  const [proxy, setProxy] = useState(brand.telegramProxy ?? '');
  const [relay, setRelay] = useState(brand.telegramApiBase ?? '');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy('save');
    setMsg(null);
    try {
      const b = await adminApi.updateBrand(brand.id, {
        telegramChatId: chatId.trim(),
        telegramProxy: proxy.trim(),
        telegramApiBase: relay.trim(),
        ...(token.trim() ? { telegramBotToken: token.trim() } : {}),
      } as Partial<AdminBrand>);
      setToken('');
      onSaved(b);
      setMsg({ ok: true, text: 'ذخیره شد.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    setMsg(null);
    try {
      const r = await adminApi.telegramTest(brand.id);
      const missed = r.errors?.length ? ` — نرسید به: ${r.errors.join('، ')}` : '';
      setMsg({
        ok: !r.errors?.length,
        text: r.buttons
          ? `پیام آزمایشی به ${r.delivered ?? 1} ادمین رسید؛ دکمه‌های تأیید/رد فعال است.${missed}`
          : `پیام آزمایشی رسید، ولی دکمه‌های تأیید/رد فعال نشد: ${r.buttonsMessage ?? ''}${missed}`,
      });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">ربات تمدید (تلگرام)</h2>
        <StatusDot ok={brand.telegramConfigured ? true : null} />
      </div>
      <p className="mt-1 text-sm leading-7 text-[var(--ink-2)]">
        هر رسید تازه با تصویر و همهٔ جزئیات سرویس، در پیوی ربات برای ادمین‌های زیر می‌آید؛ فقط همین ادمین‌ها می‌توانند تأیید یا رد کنند.
      </p>
      <ol className="mt-2 list-decimal space-y-1 ps-5 text-xs leading-6 text-[var(--ink-3)]">
        <li>با @BotFather یک ربات <b>جدید</b> بساز (توکن ربات فروشگاه HMPanel را اینجا نگذار؛ هر توکن فقط به یک سرور وصل می‌شود).</li>
        <li>هر ادمین به ربات <code dir="ltr">/start</code> بزند؛ ربات آیدی عددی‌اش را جواب می‌دهد.</li>
        <li>آیدی‌ها را با کاما جدا اینجا بنویس، ذخیره کن و «پیام آزمایشی» را بزن.</li>
      </ol>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="توکن ربات" htmlFor="tg-token" hint={brand.telegramConfigured ? 'ذخیره شده؛ برای تغییر، توکن جدید بنویس' : 'از @BotFather'}>
          <input
            id="tg-token"
            dir="ltr"
            type="password"
            autoComplete="off"
            className="field"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={brand.telegramConfigured ? '••••••••' : '123456:ABC…'}
          />
        </Field>
        <Field label="آیدی عددی ادمین‌ها" htmlFor="tg-chat" hint="مثل ‎123456789, 987654321 — حداکثر ۱۰ نفر">
          <input id="tg-chat" dir="ltr" className="field" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" />
        </Field>
      </div>
      <details className="group mt-4 rounded-xl border border-[var(--line)] open:bg-[var(--surface-2)]" open={Boolean(proxy || relay) || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
          <span className="flex-1">سرور به تلگرام دسترسی ندارد؟ (فیلتر)</span>
          <span className="text-xs text-[var(--ink-3)]">{proxy ? 'پروکسی' : relay ? 'رله' : 'مستقیم'}</span>
          <ChevronDown className="h-4 w-4 text-[var(--ink-3)] transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-3 pb-3 text-xs leading-6 text-[var(--ink-2)]">
          <p>اگر پیام آزمایشی با «سرور به تلگرام دسترسی ندارد» برگشت، یکی از این دو را بگذار (فقط مدیر سازمان می‌تواند تغییر دهد):</p>
          <Field label="پروکسی HTTP روی سرور" htmlFor="tg-proxy" hint="مثلاً کلاینت xray/v2ray روی همین سرور: http://127.0.0.1:10809">
            <input id="tg-proxy" dir="ltr" className="field" value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://127.0.0.1:10809" />
          </Field>
          <Field label="یا آدرس رله (Cloudflare Worker)" htmlFor="tg-relay" hint="یک Worker رایگان بساز، کد زیر را در آن بگذار و آدرسش را اینجا بنویس">
            <input id="tg-relay" dir="ltr" className="field" value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://tg-relay.yourname.workers.dev" />
          </Field>
          <pre dir="ltr" className="overflow-x-auto rounded-lg bg-[var(--surface)] p-3 text-[11px] leading-5">{WORKER_SNIPPET}</pre>
          <button type="button" className="text-[var(--brand)]" onClick={() => navigator.clipboard?.writeText(WORKER_SNIPPET)}>
            کپی کد Worker
          </button>
        </div>
      </details>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save} busy={busy === 'save'} disabled={busy !== null}>
          ذخیرهٔ تلگرام
        </Button>
        <Button variant="secondary" onClick={test} busy={busy === 'test'} disabled={busy !== null || !brand.telegramConfigured}>
          <Send className="h-4 w-4" /> ارسال پیام آزمایشی
        </Button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-[#1fa66a]' : 'text-[#d4373f]'}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}

function NotifyTab({ brand, draft, set }: { brand: AdminBrand; draft: AdminBrand; set: SetFn }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await adminApi.broadcast(brand.id, title.trim(), body.trim());
      setResult(`به ${r.sent} از ${r.total} دستگاه ارسال شد.`);
      setTitle('');
      setBody('');
      setSentCount((n) => n + 1);
    } catch (err) {
      setResult(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <RemindersCard draft={draft} set={set} />
      <Card>
        <h2 className="font-medium">ارسال اعلان به کاربران {brand.appName}</h2>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          {brand.devices} دستگاه اعلان را روشن کرده‌اند. برای اطلاعیهٔ قطعی، آدرس جدید یا تخفیف.
        </p>
        <form onSubmit={send} className="mt-4 space-y-4">
          <Field label="عنوان" htmlFor="n-title">
            <input id="n-title" required maxLength={80} className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="متن" htmlFor="n-body">
            <textarea id="n-body" required maxLength={240} rows={3} className="field resize-none" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" busy={busy} disabled={!brand.devices}>
              <Send className="h-4 w-4" /> ارسال اعلان
            </Button>
            {result && <p className="text-sm text-[var(--ink-2)]">{result}</p>}
          </div>
        </form>
      </Card>
      <PushLogCard brandId={brand.id} version={sentCount} />
    </div>
  );
}

/** NeoUptime per brand: the small network box in this brand's app (the key stays on the server). */
function NetworkTab({ draft, set }: { draft: AdminBrand; set: SetFn }) {
  return (
    <div className="space-y-3">
        <Card>
          <h2 className="font-medium">وضعیت شبکه در اپ (NeoUptime)</h2>
          <p className="mt-1 text-sm leading-7 text-[var(--ink-2)]">
            یک باکس کوچک زیر سربرگ اپ نشان می‌دهد شبکه پایدار است یا اختلال دارد؛ با لمس، وضعیت هر سرور و اختلال‌ها باز می‌شود. کلید فقط روی سرور می‌ماند.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="آدرس NeoUptime" htmlFor="up-url">
              <input
                id="up-url"
                dir="ltr"
                className="field"
                placeholder="https://status.example.com"
                value={draft.uptimeUrl ?? ''}
                onChange={(e) => set('uptimeUrl', e.target.value)}
              />
            </Field>
            <Field label="شناسهٔ صفحه (slug)" htmlFor="up-slug">
              <input id="up-slug" dir="ltr" className="field" placeholder="my-network" value={draft.uptimeSlug ?? ''} onChange={(e) => set('uptimeSlug', e.target.value)} />
            </Field>
            <Field label="کلید API" htmlFor="up-key">
              <input
                id="up-key"
                dir="ltr"
                type="password"
                autoComplete="off"
                className="field"
                placeholder={draft.uptimeHasKey ? 'ذخیره شده — برای تغییر بنویسید' : 'Bearer key'}
                value={draft.uptimeKey ?? ''}
                onChange={(e) => set('uptimeKey', e.target.value)}
              />
            </Field>
          </div>
          <p className="mt-2 text-xs text-[var(--ink-3)]">بعد از ذخیره، باکس در اپ ظاهر می‌شود. برای خاموش کردن، آدرس را پاک کنید.</p>
        </Card>
    </div>
  );
}
