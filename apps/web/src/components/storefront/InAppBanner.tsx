'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { inAppName, platform, systemBrowserUrl } from '@/lib/browser-env';
import { useSf } from './context';

const COPY = {
  fa: {
    ios: (app: string) => `داخل ${app} باز شده؛ برای نصب اپ و دریافت اعلان، در Safari باز کن.`,
    android: (app: string) => `داخل ${app} باز شده؛ برای نصب اپ و دریافت اعلان، در Chrome باز کن.`,
    openSafari: 'باز کردن در Safari',
    openChrome: 'باز کردن در Chrome',
    app: 'برنامهٔ دیگری',
    close: 'بستن',
  },
  en: {
    ios: (app: string) => `Opened inside ${app}. To install the app and get notifications, open it in Safari.`,
    android: (app: string) => `Opened inside ${app}. To install the app and get notifications, open it in Chrome.`,
    openSafari: 'Open in Safari',
    openChrome: 'Open in Chrome',
    app: 'another app',
    close: 'Close',
  },
} as const;

/**
 * Shown on every visit from Telegram, Instagram & co. (or Chrome on iPhone):
 * those browsers can't install the app or show notifications. Dismissable
 * for the rest of the session.
 */
export function InAppBanner() {
  const { locale } = useSf();
  const c = COPY[locale === 'en' ? 'en' : 'fa'];
  const [state, setState] = useState<{ href: string; ios: boolean; app: string } | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('nc.inapp.closed')) return;
    } catch {
      /* ignore */
    }
    const pf = platform();
    const href = systemBrowserUrl(pf, location.href);
    if (!href) return;
    const name = inAppName();
    const app = !name || name === 'app' ? (/crios/i.test(navigator.userAgent) ? 'Chrome' : c.app) : name;
    setState({ href, ios: pf === 'ios-other', app });
  }, [c.app]);

  function close() {
    setState(null);
    try {
      sessionStorage.setItem('nc.inapp.closed', '1');
    } catch {
      /* ignore */
    }
  }

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          role="status"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="fixed inset-x-0 top-0 z-[65] mx-auto max-w-[460px] px-3 pt-[max(0.6rem,env(safe-area-inset-top))]"
        >
          <div className="flex items-center gap-3 rounded-3xl bg-ink px-4 py-3 text-on-ink shadow-raise">
            <p className="min-w-0 flex-1 text-[13px] leading-6">{state.ios ? c.ios(state.app) : c.android(state.app)}</p>
            <a href={state.href} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-btn px-3 text-xs font-semibold text-btn-ink">
              <ExternalLink className="h-3.5 w-3.5" />
              {state.ios ? c.openSafari : c.openChrome}
            </a>
            <button type="button" onClick={close} aria-label={c.close} className="grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-70">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
