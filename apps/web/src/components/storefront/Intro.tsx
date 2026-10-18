'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Bell, ExternalLink, MoreVertical, PlusSquare, Share } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PushState } from '@/lib/push';
import { BrandMark } from './BrandMark';
import { useSf } from './context';

type Step = 'welcome' | 'install' | 'notify';
type Platform = 'ios-safari' | 'ios-other' | 'android' | 'android-inapp' | 'other';

const COPY = {
  fa: {
    skip: 'رد شدن',
    later: 'بعداً',
    next: 'ادامه',
    welcome: { a: 'وضعیت سرویس،', b: 'همیشه دم دستت', body: 'حجم باقی‌مانده، روزهای مانده و اتصال را یک‌جا ببین و با یک لمس تمدید کن.' },
    install: {
      a: 'نصب روی',
      b: 'صفحهٔ اصلی',
      body: 'مثل یک اپلیکیشن واقعی باز می‌شود، سریع‌تر است و اعلان‌ها کامل کار می‌کنند.',
      action: 'نصب اپلیکیشن',
      got: 'نصبش کردم',
      ios: ['در نوار پایین ⁨Safari⁩ دکمهٔ «اشتراک‌گذاری» را بزن', '«⁨Add to Home Screen⁩» را انتخاب کن', 'بالای صفحه «⁨Add⁩» را بزن'],
      iosOther: 'در آیفون فقط Safari می‌تواند اپ را نصب کند و اعلان بفرستد. با دکمهٔ زیر همین صفحه در Safari باز می‌شود.',
      inApp: 'این صفحه داخل یک برنامهٔ دیگر باز شده و نصب نمی‌شود. با دکمهٔ زیر در Chrome باز کن.',
      openSafari: 'باز کردن در Safari',
      openChrome: 'باز کردن در Chrome',
      android: ['منوی ⋮ مرورگر را باز کن', '«⁨Install app⁩» یا «⁨Add to Home screen⁩» را بزن'],
    },
    notify: {
      a: 'قبل از تمام شدن،',
      b: 'خبرت می‌کنیم',
      body: 'وقتی حجم یا زمان رو به پایان باشد یا تمدیدت انجام شود، اعلان می‌گیری؛ حتی وقتی اپ بسته است.',
      action: 'روشن کردن اعلان‌ها',
      iosLater: 'در آیفون، اعلان بعد از نصب روی صفحهٔ اصلی روشن می‌شود. اپ نصب‌شده را باز کن تا همین‌جا فعالش کنیم.',
      blocked: 'اعلان در تنظیمات مرورگر مسدود است؛ از تنظیمات سایت اجازه بده.',
    },
    start: 'شروع',
  },
  en: {
    skip: 'Skip',
    later: 'Later',
    next: 'Next',
    welcome: { a: 'Your service,', b: 'always at hand', body: 'See remaining data, days left and connection status in one place, and renew in a tap.' },
    install: {
      a: 'Add it to your',
      b: 'home screen',
      body: 'It opens like a real app, loads faster and notifications work fully.',
      action: 'Install app',
      got: 'I installed it',
      ios: ['Tap Share in Safari’s bottom bar', 'Choose “Add to Home Screen”', 'Tap “Add” at the top'],
      iosOther: 'On iPhone only Safari can install apps and send notifications. The button below opens this page in Safari.',
      inApp: 'This page is open inside another app and cannot be installed. Open it in Chrome below.',
      openSafari: 'Open in Safari',
      openChrome: 'Open in Chrome',
      android: ['Open the browser ⋮ menu', 'Tap “Install app” or “Add to Home screen”'],
    },
    notify: {
      a: 'We’ll tell you',
      b: 'before it runs out',
      body: 'Get a notification when data or time is running low or your renewal goes through — even with the app closed.',
      action: 'Turn on notifications',
      iosLater: 'On iPhone, notifications turn on after installing to the home screen. Open the installed app to enable them here.',
      blocked: 'Notifications are blocked in browser settings; allow them for this site.',
    },
    start: 'Get started',
  },
} as const;

const IN_APP = /FBAN|FBAV|Instagram|Line\/|Twitter|Telegram|WhatsApp|Snapchat|; wv\)/i;

function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) {
    // Chrome/Firefox/Edge on iPhone and in-app browsers cannot install or get notifications.
    return /crios|fxios|edgios|opios/i.test(ua) || IN_APP.test(ua) ? 'ios-other' : 'ios-safari';
  }
  if (/android/i.test(ua)) return IN_APP.test(ua) ? 'android-inapp' : 'android';
  return 'other';
}

/** A link that reopens this exact page in the system browser that can install it. */
export function systemBrowserUrl(pf: Platform, href: string): string | null {
  if (pf === 'ios-other') return `x-safari-${href}`;
  if (pf === 'android-inapp') {
    const u = new URL(href);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  return null;
}

/** Full-screen first-run guide: welcome, install to home screen, notifications. Skippable at any step. */
export function Intro({
  standalone,
  canPrompt,
  onInstall,
  push,
  onEnablePush,
  onDone,
}: {
  standalone: boolean;
  canPrompt: boolean;
  onInstall: () => Promise<boolean>;
  push: PushState;
  onEnablePush: () => Promise<PushState>;
  onDone: () => void;
}) {
  const { brand, locale } = useSf();
  const c = COPY[locale === 'en' ? 'en' : 'fa'];
  const pf = useMemo(platform, []);
  const steps = useMemo<Step[]>(() => {
    const list: Step[] = ['welcome'];
    if (!standalone) list.push('install');
    if (push !== 'on' && push !== 'unsupported') list.push('notify');
    return list;
    // Decided once when the intro opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pushNow, setPushNow] = useState(push);
  const step = steps[i];
  const last = i === steps.length - 1;
  const next = () => (last ? onDone() : setI(i + 1));

  // Opened in Chrome on iPhone or inside Telegram/Instagram: hop to Safari / Chrome once, automatically.
  const reopen = useMemo(() => (typeof location === 'undefined' ? null : systemBrowserUrl(pf, location.href)), [pf]);
  useEffect(() => {
    if (!reopen) return;
    try {
      if (sessionStorage.getItem('nc.reopen.tried')) return;
      sessionStorage.setItem('nc.reopen.tried', '1');
    } catch {
      /* ignore */
    }
    const id = setTimeout(() => {
      window.location.href = reopen;
    }, 900);
    return () => clearTimeout(id);
  }, [reopen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDone]);

  // One glow color per step, from the brand: primary → accent → signal.
  const glow = step === 'welcome' ? 'var(--brand)' : step === 'install' ? 'var(--accent)' : 'var(--signal, var(--brand))';
  const base = step === 'welcome' ? c.welcome : step === 'install' ? c.install : c.notify;
  const own = locale === (brand.defaultLocale === 'en' ? 'en' : 'fa') ? brand.copy ?? {} : {};
  const key = step === 'welcome' ? 'Welcome' : step === 'install' ? 'Install' : 'Notify';
  const title = {
    a: own[`intro${key}A` as const] || base.a,
    b: own[`intro${key}B` as const] || base.b,
    body: own[`intro${key}Body` as const] || base.body,
  };
  const ink = useMemo(() => readableInk(step === 'welcome' ? '--brand' : step === 'install' ? '--accent' : '--signal'), [step]);

  async function primary() {
    if (step === 'install' && canPrompt) {
      setBusy(true);
      await onInstall().catch(() => false);
      setBusy(false);
      return next();
    }
    if (step === 'notify' && pushNow === 'off') {
      setBusy(true);
      const result = await onEnablePush().catch(() => 'off' as PushState);
      setPushNow(result);
      setBusy(false);
      if (result === 'on') return next();
      return;
    }
    next();
  }

  const primaryLabel =
    step === 'install' && canPrompt
      ? c.install.action
      : step === 'install'
        ? c.install.got
        : step === 'notify' && pushNow === 'off'
          ? c.notify.action
          : last
            ? c.start
            : c.next;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={brand.appName}
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#09090c] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* the glow: a soft pool of color filling the top of the screen */}
      <AnimatePresence>
        <motion.div
          key={step}
          aria-hidden
          className="pointer-events-none absolute -inset-x-[15%] -top-[8%] h-[72%]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: `radial-gradient(62% 58% at 50% 40%, ${glow} 0%, ${glow} 30%, transparent 74%)`,
            filter: 'blur(28px)',
          }}
        />
      </AnimatePresence>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[6%] h-[34%]"
        style={{ background: 'radial-gradient(34% 42% at 64% 42%, rgba(255,255,255,.75), transparent 72%)', filter: 'blur(26px)' }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-[#09090c] via-[#09090c]/90 to-transparent" />

      <div className="relative flex justify-end px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onDone} className="h-10 rounded-full px-4 text-sm text-white/80">
          {c.skip}
        </button>
      </div>

      <div className="relative mt-auto px-7 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2.5">
          <BrandMark brand={brand} size={28} onDark />
          <span className="text-[15px] font-semibold">{brand.appName}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="mt-5 text-[2.15rem] font-medium leading-[1.2] tracking-tight">
              {title.a}
              <br />
              <span style={{ color: glow }}>{title.b}</span>
            </h1>
            <p className="mt-3 max-w-[34ch] text-sm leading-7 text-white/65">{title.body}</p>

            {step === 'install' && !canPrompt && !reopen && <InstallSteps pf={pf} c={c.install} />}
            {reopen && (step === 'install' || step === 'welcome') && (
              <div className="mt-5">
                <Note>{pf === 'ios-other' ? c.install.iosOther : c.install.inApp}</Note>
                <a
                  href={reopen}
                  className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl bg-white text-sm font-medium text-[#111]"
                >
                  <ExternalLink className="h-4 w-4" />
                  {pf === 'ios-other' ? c.install.openSafari : c.install.openChrome}
                </a>
              </div>
            )}
            {step === 'notify' && pushNow === 'ios-needs-install' && <Note>{c.notify.iosLater}</Note>}
            {step === 'notify' && pushNow === 'denied' && <Note>{c.notify.blocked}</Note>}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6 flex gap-1.5" aria-hidden>
          {steps.map((s, j) => (
            <span
              key={s}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: j === i ? 28 : 6, background: j === i ? glow : 'rgba(255,255,255,.35)' }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={primary}
          disabled={busy}
          className="relative mt-6 flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-[1.1rem] text-[15px] font-medium disabled:opacity-70"
          style={{ background: glow, color: ink }}
        >
          <span aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(60% 120% at 50% 100%, rgba(255,255,255,.35), transparent 70%)' }} />
          {step === 'notify' && pushNow === 'off' && <Bell className="relative h-4 w-4" />}
          <span className="relative">{primaryLabel}</span>
        </button>
        {step === 'welcome' ? (
          <div className="mt-2 h-12" />
        ) : (
          <button type="button" onClick={next} className="mt-2 h-12 w-full text-sm text-white/80">
            {c.later}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** White or near-black text, whichever reads on the brand color behind it. */
function readableInk(cssVar: string) {
  if (typeof document === 'undefined') return '#fff';
  const el = document.querySelector('.sf-root') ?? document.documentElement;
  const raw = getComputedStyle(el).getPropertyValue(cssVar).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#121212' : '#fff';
}

function InstallSteps({ pf, c }: { pf: Platform; c: (typeof COPY)['fa']['install'] | (typeof COPY)['en']['install'] }) {
  const items = pf === 'ios-safari' ? c.ios : c.android;
  const icons = pf === 'ios-safari' ? [Share, PlusSquare, PlusSquare] : [MoreVertical, PlusSquare];
  return (
    <ol className="mt-5 space-y-2">
      {items.map((text, n) => {
        const Icon = icons[n] ?? PlusSquare;
        return (
          <li key={text} className="flex items-center gap-3 rounded-2xl bg-white/10 px-3.5 py-3 backdrop-blur">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs">{n + 1}</span>
            <span className="flex-1 text-sm">{text}</span>
            <Icon className="h-4 w-4 text-white/70" />
          </li>
        );
      })}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-[13px] leading-6 text-white/85">{children}</p>;
}
