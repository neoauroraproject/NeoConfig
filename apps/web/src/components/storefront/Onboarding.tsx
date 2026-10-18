'use client';

import { motion } from 'framer-motion';
import { ArrowUpLeft, ArrowUpRight, ClipboardPaste, Download, Loader2, ShoppingBag } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import { useSf } from './context';

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (url: string) => void;
  canInstall: boolean;
  onInstall: () => void;
  onCancel?: () => void;
  onBuy?: () => void;
};

export function Onboarding({ busy, error, onSubmit, canInstall, onInstall, onCancel, onBuy }: Props) {
  const { brand, t, locale } = useSf();
  const [url, setUrl] = useState('');
  const [canPaste, setCanPaste] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const Arrow = locale === 'fa' ? ArrowUpLeft : ArrowUpRight;
  const graphite = brand.theme === 'graphite';
  // The brand's own wording applies in its default language.
  const own = locale === (brand.defaultLocale === 'en' ? 'en' : 'fa') ? brand.copy ?? {} : {};

  // The button is always there: it either reads the clipboard or opens the phone's own paste.
  useEffect(() => {
    setCanPaste(typeof navigator !== 'undefined');
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (url.trim() && !busy) onSubmit(url.trim());
  }

  function take(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setUrl(clean);
    setPasteHint(false);
    if (/^https?:\/\//i.test(clean) && !busy) onSubmit(clean);
  }

  /**
   * iPhone shows its own «Paste» bubble for clipboard reads; Android may ask
   * for permission or refuse. When reading isn't allowed, focus the field so
   * the keyboard's paste (or a long-press → Paste) does it natively.
   */
  async function paste() {
    inputRef.current?.focus();
    try {
      const state = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName }).catch(() => null);
      if (state?.state === 'denied' || !navigator.clipboard?.readText) throw new Error('blocked');
      take(await navigator.clipboard.readText());
    } catch {
      setPasteHint(true);
    }
  }

  const [kickerA, kickerB] = splitKicker(brand.tagline || t('onboardKicker'));

  return (
    <div className="relative overflow-hidden bg-surface tab:my-8 tab:rounded-5xl tab:shadow-raise wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="relative flex min-h-dvh flex-col tab:min-h-[min(720px,calc(100dvh-4rem))] wide:min-h-[min(660px,calc(100dvh-4rem))]">
      {graphite ? <DotField /> : brand.theme === 'pearl' ? <PearlGlow /> : brand.theme === 'moss' ? null : <Aurora />}

      <header className="relative z-10 flex items-center justify-between px-7 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <BrandMark brand={brand} size={36} />
        {onCancel ? (
          <button type="button" onClick={onCancel} className="h-10 rounded-full px-4 text-sm text-ink-2">
            {t('cancel')}
          </button>
        ) : (
          canInstall && (
            <button
              type="button"
              onClick={onInstall}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-medium text-ink shadow-raise-sm"
            >
              <Download className="h-4 w-4" />
              {t('installApp')}
            </button>
          )
        )}
      </header>

      <div className="relative z-10 mt-auto px-7 pb-7 tab:px-9 tab:pb-9">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[13px] leading-6 text-ink-2">
            {kickerA}
            {kickerB && <br />}
            {kickerB}
          </p>
          <h1 className="mt-5 whitespace-pre-line text-[2.6rem] font-normal leading-[1.15] tracking-tight text-ink">
            {own.onboardTitle || t('onboardTitle')}
          </h1>
          <p className="mt-4 max-w-[30ch] text-sm leading-7 text-ink-2">{own.onboardBody || t('onboardBody')}</p>
        </motion.div>

        <form onSubmit={submit} className="mt-8" noValidate>
          <label htmlFor="sub-url" className="mb-2 block text-[13px] font-medium text-ink-2">
            {t('linkLabel')}
          </label>
          <div className="flex items-stretch gap-2.5">
            <div className="relative flex-1">
              <input
                id="sub-url"
                dir="ltr"
                inputMode="url"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onPaste={(e) => {
                  // A native paste (keyboard or long-press) goes straight to the lookup.
                  const text = e.clipboardData.getData('text');
                  if (/^https?:\/\//i.test(text.trim())) {
                    e.preventDefault();
                    take(text);
                  }
                }}
                placeholder="https://"
                aria-describedby="sub-url-hint sub-url-error"
                aria-invalid={Boolean(error)}
                className="h-16 w-full rounded-4xl bg-surface-2 pe-4 ps-5 text-base text-ink shadow-raise-sm outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-[var(--brand)]"
                style={canPaste && !url ? { paddingInlineEnd: '6.5rem' } : undefined}
              />
              {canPaste && !url && (
                <button
                  type="button"
                  onClick={paste}
                  className="absolute end-2 top-1/2 inline-flex h-12 -translate-y-1/2 items-center gap-1.5 rounded-3xl bg-surface px-3.5 text-[13px] font-medium text-ink"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  {t('paste')}
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !url.trim()}
              aria-label={t('showSub')}
              className="grid h-16 w-16 shrink-0 place-items-center rounded-4xl bg-btn text-btn-ink shadow-raise-sm transition-opacity disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Arrow className="h-6 w-6" strokeWidth={1.6} />}
            </button>
          </div>
          <p id="sub-url-hint" className={`mt-2 text-xs ${pasteHint && !busy ? 'text-brand' : 'text-ink-3'}`}>
            {busy ? t('checking') : pasteHint ? t('pasteHint') : t('linkHint')}
          </p>
          <p id="sub-url-error" role="alert" className="min-h-[1.5rem] text-[13px] text-[#d4373f]">
            {error}
          </p>
        </form>
        {onBuy && (
          <button
            type="button"
            onClick={onBuy}
            className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-3xl border border-line text-sm font-medium text-ink"
          >
            <ShoppingBag className="h-4 w-4" />
            {t('buyNew')}
          </button>
        )}
      </div>
      </div>
      <Showcase />
    </div>
  );
}

/** Desktop only: a glimpse of what the dashboard shows, so the wide card isn't half empty. */
function Showcase() {
  const { t, locale } = useSf();
  return (
    <div aria-hidden className="relative hidden p-4 wide:block">
      <div className="sf-hero relative flex h-full flex-col justify-between overflow-hidden rounded-[2.25rem] bg-surface-2 p-8">
        <div
          className="pointer-events-none absolute -end-16 -top-20 h-72 w-72 rounded-full opacity-40"
          style={{ background: 'radial-gradient(closest-side, var(--brand), transparent)' }}
        />
        <div className="relative">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="h-2 w-2 rounded-full bg-[#1fa66a]" />
            {t('onlineNow')}
          </p>
          <p className="mt-6 text-[13px] text-ink-2">{t('remaining')}</p>
          <p dir="ltr" className="num mt-1 flex items-baseline gap-2 text-ink" style={{ justifyContent: locale === 'fa' ? 'flex-end' : 'flex-start' }}>
            <span className="text-[4.25rem] font-light leading-tight">
              31<span className="text-ink-3">.60</span>
            </span>
            <span className="text-lg text-ink-2">GB</span>
          </p>
        </div>
        <div className="relative mt-8 grid grid-cols-2 gap-3">
          <div className="flex min-h-[9.5rem] flex-col justify-end rounded-4xl p-5 shadow-raise" style={{ background: 'var(--hi)', color: 'var(--on-hi)' }}>
            <p className="num text-[2.4rem] font-light leading-none">24</p>
            <p className="mt-2 text-[13px] opacity-85">{t('daysLeft')}</p>
          </div>
          <div className="flex min-h-[9.5rem] flex-col rounded-4xl bg-surface p-5 shadow-raise">
            <p className="text-[13px] text-ink-2">{t('dailyUsage')}</p>
            <div className="mt-auto flex h-14 items-end gap-1" dir="ltr">
              {[38, 62, 45, 80, 52, 70, 95].map((h, i) => (
                <span key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: i === 6 ? 'var(--signal)' : 'var(--ink)', opacity: i === 6 ? 1 : 0.8 }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pearl: the sheen pooling at the top of the card. */
function PearlGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[55%] opacity-90"
      style={{
        background: 'var(--pearl)',
        maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
      }}
    />
  );
}

function splitKicker(s: string): [string, string] {
  const words = s.split(' ');
  if (words.length < 4) return [s, ''];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

/** Soft brand-colored light pooling behind the form (mist & sage). */
function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute -bottom-24 start-[-20%] h-[70%] w-[90%] rounded-full opacity-[0.28]"
        style={{ background: 'radial-gradient(closest-side, var(--brand), transparent)' }}
      />
      <div
        className="absolute bottom-[8%] end-[-25%] h-[45%] w-[70%] rounded-full opacity-[0.18]"
        style={{ background: 'radial-gradient(closest-side, var(--accent), transparent)' }}
      />
    </div>
  );
}

/** Dot matrix for the graphite theme. */
function DotField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[46%] opacity-60"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--ink-3) 1px, transparent 1.4px)',
        backgroundSize: '22px 22px',
        maskImage: 'linear-gradient(to bottom, black 40%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 40%, transparent)',
      }}
    />
  );
}
