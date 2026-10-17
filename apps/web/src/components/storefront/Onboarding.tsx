'use client';

import { motion } from 'framer-motion';
import { ArrowUpLeft, ArrowUpRight, ClipboardPaste, Download, Loader2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { BrandMark } from './BrandMark';
import { useSf } from './context';

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (url: string) => void;
  canInstall: boolean;
  onInstall: () => void;
  onCancel?: () => void;
};

export function Onboarding({ busy, error, onSubmit, canInstall, onInstall, onCancel }: Props) {
  const { brand, t, locale } = useSf();
  const [url, setUrl] = useState('');
  const [canPaste, setCanPaste] = useState(false);
  const Arrow = locale === 'fa' ? ArrowUpLeft : ArrowUpRight;
  const graphite = brand.theme === 'graphite';

  useEffect(() => {
    setCanPaste(typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.readText));
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (url.trim() && !busy) onSubmit(url.trim());
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        if (/^https?:\/\//i.test(text)) onSubmit(text);
      }
    } catch {
      /* permission denied — the field still accepts a manual paste */
    }
  }

  const [kickerA, kickerB] = splitKicker(brand.tagline || t('onboardKicker'));

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-surface sm:my-8 sm:min-h-[min(720px,calc(100dvh-4rem))] sm:rounded-5xl sm:shadow-raise">
      {graphite ? <DotField /> : <Aurora />}

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

      <div className="relative z-10 mt-auto px-7 pb-7 sm:px-9 sm:pb-9">
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
            {t('onboardTitle')}
          </h1>
          <p className="mt-4 max-w-[30ch] text-sm leading-7 text-ink-2">{t('onboardBody')}</p>
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
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                aria-describedby="sub-url-hint sub-url-error"
                aria-invalid={Boolean(error)}
                className="h-16 w-full rounded-4xl bg-surface-2 pe-4 ps-5 text-[15px] text-ink shadow-raise-sm outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-[var(--brand)]"
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
              className="grid h-16 w-16 shrink-0 place-items-center rounded-4xl bg-brand text-[var(--on-brand)] shadow-raise-sm transition-opacity disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Arrow className="h-6 w-6" strokeWidth={1.6} />}
            </button>
          </div>
          <p id="sub-url-hint" className="mt-2 text-xs text-ink-3">
            {busy ? t('checking') : t('linkHint')}
          </p>
          <p id="sub-url-error" role="alert" className="min-h-[1.5rem] text-[13px] text-[#d4373f]">
            {error}
          </p>
        </form>
      </div>
    </div>
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
