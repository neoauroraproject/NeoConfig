'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccountState,
  SavedAccount,
  TrackedRenewal,
  accountId,
  loadAccounts,
  loadRenewals,
  saveAccounts,
  saveRenewals,
  upsertAccount,
} from '@/lib/accounts';
import { ApiError, Branding, LookupResponse, PublicRenewal, ThemeId, publicApi } from '@/lib/api';
import { THEME_CANVAS } from '@/lib/themes';
import { deviceId } from '@/lib/device';
import { Locale, isRtl } from '@/lib/i18n';
import { PushState, disablePush, enablePush, followsOf, isIos, isStandalone, pushState, syncPush } from '@/lib/push';
import { demoHistory, demoLookup } from './demo';
import { Dashboard } from './Dashboard';
import { Onboarding } from './Onboarding';
import { PullToRefresh } from './PullToRefresh';
import { Intro } from './Intro';
import { InAppBanner } from './InAppBanner';
import { RenewalDetailSheet } from './RenewalDetailSheet';
import { RenewSheet } from './RenewSheet';
import { AccountsSheet, InstallIosSheet, MenuSheet, QrSheet } from './Sheets';
import { AppsSheet, InfoSheet } from './InfoSheets';
import { SfContext, brandStyle, makeT } from './context';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type SheetName = 'accounts' | 'menu' | 'qr' | 'renew' | 'purchase' | 'install' | 'apps' | 'info' | null;

export function Storefront({ brand, tenant, demo = false }: { brand: Branding; tenant: string; demo?: boolean }) {
  const storeKey = demo ? `demo.${tenant}` : tenant;
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AccountState>({ accounts: [], activeId: null });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [locale, setLocale] = useState<Locale>(brand.defaultLocale === 'en' ? 'en' : 'fa');
  const themes = brand.themes?.length ? brand.themes : [brand.theme];
  const [theme, setTheme] = useState<ThemeId>(brand.theme);
  const shown = useMemo(() => ({ ...brand, theme }), [brand, theme]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [push, setPush] = useState<PushState>('unsupported');
  const [showIntro, setShowIntro] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tracked, setTracked] = useState<TrackedRenewal[]>([]);
  const [renewals, setRenewals] = useState<PublicRenewal[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const t = useMemo(() => makeT(locale), [locale]);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const active = state.accounts.find((a) => a.id === state.activeId) ?? null;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSync = useRef(0);
  const syncing = useRef(new Set<string>());
  const seenStatus = useRef<Record<string, string>>({});

  // ---------- boot ----------
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nc.locale');
      if (saved === 'fa' || saved === 'en') setLocale(saved);
      const savedTheme = localStorage.getItem(`nc.theme.${storeKey}`) as ThemeId | null;
      if (savedTheme && themes.includes(savedTheme)) setTheme(savedTheme);
    } catch {
      /* ignore */
    }
    const s = loadAccounts(storeKey);
    setState(s);
    // A push about a renewal opens its details (and makes sure it is followed).
    const fromPush = new URLSearchParams(location.search).get('renewal');
    const known = loadRenewals(storeKey);
    if (fromPush && /^[a-z0-9]{10,40}$/.test(fromPush)) {
      if (!known.some((r) => r.id === fromPush)) known.push({ id: fromPush, accountId: s.activeId ?? 'new' });
      setDetailId(fromPush);
      history.replaceState(null, '', location.pathname);
    }
    setTracked(known);
    setReady(true);
    setStandalone(isStandalone());
    // Anonymous usage count: one «open» per device per day.
    if (!demo) {
      try {
        const day = new Date().toISOString().slice(0, 10);
        const key = `nc.track.${storeKey}`;
        if (localStorage.getItem(key) !== day) {
          localStorage.setItem(key, day);
          void publicApi.track({ tenant, deviceId: deviceId(), event: 'open', standalone: isStandalone(), locale: navigator.language });
        }
      } catch {
        /* ignore */
      }
    }
    if (!demo && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    void pushState().then((p) => {
      setPush(p);
      // First visit on a phone: welcome, install guide, notification permission (once per storefront).
      try {
        const forced = new URLSearchParams(location.search).has('intro');
        const seen = localStorage.getItem(`nc.intro.v1.${storeKey}`);
        const phone = window.matchMedia('(pointer: coarse)').matches;
        if (forced || (phone && !seen && !(isStandalone() && p === 'on'))) setShowIntro(true);
      } catch {
        /* storage blocked: skip the intro */
      }
      // Devices that turned push on before reminders existed never sent their links.
      if (p === 'on' && !demo) void syncPush(tenant, followsOf(s.accounts));
    });
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvt(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    // Silent refresh of every saved account.
    if (s.accounts.length) void refreshAll(s);
    // Demo only: ?sample=1 opens straight on a filled-in dashboard (screenshots, sales demos).
    if (demo && !s.accounts.length && new URLSearchParams(location.search).has('sample')) {
      const url = 'https://demo.neoconfig.app/sub/aria-2026';
      void demoLookup(url).then((res) => {
        const next = upsertAccount(s, url, { ...res, snapshot: { ...res.snapshot, displayName: 'Aria · Germany' } });
        persist({
          ...next,
          accounts: next.accounts.map((a) => ({ ...a, label: 'Aria · Germany', history: demoHistory(res.snapshot.totalUsedBytes ?? 0) })),
        });
      });
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  // Renewal statuses: on load, when a new one is filed, and every minute while one is pending.
  useEffect(() => {
    if (demo || !tracked.length) {
      setRenewals([]);
      return;
    }
    let stop = false;
    const load = () =>
      publicApi
        .renewalStatus(tracked.map((r) => r.id))
        .then((rows) => {
          if (stop) return;
          // Just approved: the panel already has the new time and data — show it now.
          for (const r of rows) {
            const before = seenStatus.current[r.id];
            if (before && before !== r.status && r.status === 'approved') {
              const accountId = tracked.find((x) => x.id === r.id)?.accountId ?? r.subId;
              void refreshAccount(accountId);
              toast(`${t('approved')} ✓`);
            }
            seenStatus.current[r.id] = r.status;
            if (r.kind === 'purchase' && r.status === 'approved' && r.subscriptionUrl) void adoptPurchase(r.id, r.subscriptionUrl);
          }
          setRenewals(rows);
        })
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [tracked, demo]);

  const persist = useCallback(
    (next: AccountState) => {
      setState(next);
      saveAccounts(storeKey, next);
    },
    [storeKey],
  );

  async function lookup(url: string): Promise<LookupResponse> {
    return demo ? demoLookup(url) : publicApi.lookup(url, tenant);
  }

  function trackAdd(subId: string, displayName: string) {
    void publicApi.track({ tenant, deviceId: deviceId(), event: 'add', standalone: isStandalone(), locale: navigator.language, subId, displayName });
  }

  /** A bought service was delivered: add it to this device once, and follow it for reminders. */
  async function adoptPurchase(id: string, url: string) {
    const key = `nc.purchases.done.${storeKey}`;
    let done: string[] = [];
    try {
      done = JSON.parse(localStorage.getItem(key) || '[]') as string[];
    } catch {
      /* ignore */
    }
    if (done.includes(id)) return;
    try {
      const res = await lookup(url);
      const next = upsertAccount(stateRef.current, url, res);
      persist(next);
      void syncPush(tenant, followsOf(next.accounts));
      trackAdd(accountId(res, url), res.snapshot.displayName);
      localStorage.setItem(key, JSON.stringify([...done, id].slice(-50)));
      setAdding(false);
      toast(t('newServiceAdded'));
    } catch {
      /* try again on the next status poll */
    }
  }

  /** Background sync of one account: no spinner, no toast, keeps the last data on failure. */
  async function refreshAccount(id: string | null) {
    const target = stateRef.current.accounts.find((a) => a.id === id);
    if (!target || syncing.current.has(target.id)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    syncing.current.add(target.id);
    if (target.id === stateRef.current.activeId) lastSync.current = Date.now();
    try {
      const res = await lookup(target.url);
      const cur = stateRef.current;
      persist({ ...upsertAccount(cur, target.url, res), activeId: cur.activeId });
    } catch {
      /* the manual refresh button reports errors */
    } finally {
      syncing.current.delete(target.id);
    }
  }

  // Keep the numbers live: every 45s while the app is on screen, and right away
  // when it comes back to the foreground or the connection returns.
  useEffect(() => {
    if (!ready) return;
    const sync = (minAge: number) => () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastSync.current < minAge) return;
      void refreshAccount(stateRef.current.activeId);
    };
    const tick = sync(40_000);
    const wake = sync(15_000);
    const id = setInterval(tick, 45_000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function refreshAll(s: AccountState) {
    lastSync.current = Date.now();
    setRefreshing(true);
    let next = s;
    for (const a of s.accounts) {
      try {
        const res = await lookup(a.url);
        const activeId = next.activeId;
        next = { ...upsertAccount(next, a.url, res), activeId };
      } catch {
        next = { ...next, accounts: next.accounts.map((x) => (x.id === a.id ? { ...x, stale: true } : x)) };
      }
    }
    persist(next);
    setRefreshing(false);
  }

  async function refreshActive() {
    if (!active) return;
    lastSync.current = Date.now();
    setRefreshing(true);
    try {
      const res = await lookup(active.url);
      persist({ ...upsertAccount(state, active.url, res), activeId: state.activeId });
      toast(`${t('updated')} ✓`);
    } catch (err) {
      persist({ ...state, accounts: state.accounts.map((x) => (x.id === active.id ? { ...x, stale: true } : x)) });
      toast(errorText(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function addAccount(url: string) {
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setError(t('err_invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await lookup(url);
      const id = accountId(res, url);
      if (adding && state.accounts.some((a) => a.id === id)) {
        persist({ ...state, activeId: id });
        toast(t('duplicate'));
      } else {
        let next = upsertAccount(state, url, res);
        if (demo) {
          next = {
            ...next,
            accounts: next.accounts.map((a) =>
              a.id === id ? { ...a, history: demoHistory(res.snapshot.totalUsedBytes ?? 0) } : a,
            ),
          };
        }
        persist(next);
        void syncPush(tenant, followsOf(next.accounts));
        if (!demo) trackAdd(id, res.snapshot.displayName);
      }
      setAdding(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function errorText(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 0) return t('err_network');
      if (err.status === 404) return t('err_notfound');
      if (err.status === 400 || err.status === 403) return t('err_invalid');
      if (err.status === 429) return t('err_rate');
    }
    return t('err_generic');
  }

  async function install() {
    if (installEvt) {
      await installEvt.prompt();
      const choice = await installEvt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') toast(t('installed'));
      setInstallEvt(null);
    } else if (isIos()) {
      setSheet('install');
    }
  }

  async function togglePush() {
    if (demo) return;
    try {
      if (push === 'on') {
        await disablePush();
        setPush('off');
      } else {
        setPush(await enablePush(tenant, followsOf(state.accounts)));
      }
    } catch {
      toast(t('err_generic'));
    }
  }

  // The status bar follows the theme the customer picked.
  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_CANVAS[theme]));
  }, [theme]);

  function finishIntro() {
    setShowIntro(false);
    try {
      localStorage.setItem(`nc.intro.v1.${storeKey}`, '1');
    } catch {
      /* ignore */
    }
  }

  async function installFromIntro() {
    if (!installEvt) return false;
    await installEvt.prompt();
    const choice = await installEvt.userChoice.catch(() => null);
    setInstallEvt(null);
    return choice?.outcome === 'accepted';
  }

  async function pushFromIntro(): Promise<PushState> {
    if (demo) {
      const p = await Notification.requestPermission();
      return p === 'granted' ? 'on' : p === 'denied' ? 'denied' : 'off';
    }
    const next = await enablePush(tenant, followsOf(stateRef.current.accounts));
    setPush(next);
    return next;
  }

  function changeTheme(next: ThemeId) {
    setTheme(next);
    try {
      localStorage.setItem(`nc.theme.${storeKey}`, next);
    } catch {
      /* ignore */
    }
  }

  function changeLocale(l: Locale) {
    setLocale(l);
    try {
      localStorage.setItem('nc.locale', l);
    } catch {
      /* ignore */
    }
  }

  const ctx = { brand: shown, tenant, locale, t, toast, preview: demo };
  const canInstall = !standalone && (Boolean(installEvt) || isIosSafe());
  // Pending requests stay visible; decided ones show for three days.
  const recent = (r: PublicRenewal) => r.status === 'pending' || Date.now() - new Date(r.decidedAt ?? r.createdAt).getTime() < 3 * 86_400_000;
  const accountRenewals = active
    ? renewals.filter(
        (r) =>
          (r.kind === 'purchase' || r.subId === active.id || tracked.some((x) => x.id === r.id && x.accountId === active.id)) && recent(r),
      )
    : [];
  const detail = renewals.find((r) => r.id === detailId) ?? null;
  const trackNew = (r: PublicRenewal, accountId: string) => {
    const next = [...tracked, { id: r.id, accountId }];
    setTracked(next);
    saveRenewals(storeKey, next);
  };

  return (
    <SfContext.Provider value={ctx}>
      <div data-theme={theme} className="sf sf-root min-h-dvh" style={brandStyle(brand)} dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
        {!ready ? (
          <div className="min-h-dvh" />
        ) : !active || adding ? (
          <div className="mx-auto w-full max-w-[440px] tab:flex tab:min-h-dvh tab:max-w-[460px] tab:flex-col tab:justify-center tab:px-4 wide:max-w-[1080px] wide:px-8">
            <Onboarding
              busy={busy}
              error={error}
              onSubmit={addAccount}
              canInstall={canInstall}
              onInstall={install}
              onCancel={adding && active ? () => (setAdding(false), setError(null)) : undefined}
              onBuy={brand.purchase ? () => setSheet('purchase') : undefined}
            />
          </div>
        ) : (
          <PullToRefresh onRefresh={refreshActive} refreshing={refreshing} disabled={sheet !== null}>
          <Dashboard
            account={active}
            accountCount={state.accounts.length}
            refreshing={refreshing}
            renewals={accountRenewals}
            onRenewalOpen={setDetailId}
            onRefresh={refreshActive}
            onApps={() => setSheet('apps')}
            onInfo={() => setSheet('info')}
            onQr={() => setSheet('qr')}
            onRenew={() => setSheet('renew')}
            onAccounts={() => setSheet('accounts')}
            onAdd={() => {
              setError(null);
              setAdding(true);
            }}
            onMenu={() => setSheet('menu')}
          />
          </PullToRefresh>
        )}

        {active && (
          <>
            <AccountsSheet
              open={sheet === 'accounts'}
              onClose={() => setSheet(null)}
              accounts={state.accounts}
              activeId={state.activeId}
              onSelect={(id) => {
                persist({ ...state, activeId: id });
                setSheet(null);
              }}
              onAdd={() => {
                setSheet(null);
                setError(null);
                setAdding(true);
              }}
              onRename={(id, label) =>
                persist({ ...state, accounts: state.accounts.map((a) => (a.id === id ? { ...a, label: label || null } : a)) })
              }
              onRemove={(id) => {
                const accounts = state.accounts.filter((a) => a.id !== id);
                persist({ accounts, activeId: state.activeId === id ? accounts[0]?.id ?? null : state.activeId });
                void syncPush(tenant, followsOf(accounts));
                if (!accounts.length) setSheet(null);
              }}
            />
            <QrSheet open={sheet === 'qr'} onClose={() => setSheet(null)} url={active.url} />
            <AppsSheet open={sheet === 'apps'} onClose={() => setSheet(null)} account={active} />
            <InfoSheet open={sheet === 'info'} onClose={() => setSheet(null)} account={active} />
            <RenewSheet
              open={sheet === 'renew'}
              onClose={() => setSheet(null)}
              subUrl={active.url}
              serviceKind={active.serviceKind}
              storeCategoryId={active.storeCategoryId}
              panelId={active.panelId}
              sourcePanelRef={active.sourcePanelRef}
              push={push}
              onEnablePush={togglePush}
              onSubmitted={(r) => trackNew(r, active.id)}
            />
          </>
        )}
        {brand.purchase && (
          <RenewSheet
            mode="purchase"
            open={sheet === 'purchase'}
            onClose={() => setSheet(null)}
            push={push}
            onEnablePush={togglePush}
            onSubmitted={(r) => trackNew(r, 'new')}
          />
        )}
        <RenewalDetailSheet
          renewal={detail}
          onClose={() => setDetailId(null)}
          onRetry={(r) => {
            setDetailId(null);
            setSheet(r.kind === 'purchase' ? 'purchase' : 'renew');
          }}
        />
        <MenuSheet
          open={sheet === 'menu'}
          onClose={() => setSheet(null)}
          locale={locale}
          onLocale={changeLocale}
          push={push}
          onPushToggle={togglePush}
          theme={theme}
          themes={themes}
          onTheme={changeTheme}
          onBuy={
            brand.purchase
              ? () => {
                  setSheet('purchase');
                }
              : undefined
          }
        />
        <InstallIosSheet open={sheet === 'install'} onClose={() => setSheet(null)} />

        {!showIntro && !demo && <InAppBanner />}

        <AnimatePresence>
          {showIntro && (
            <Intro
              standalone={standalone}
              canPrompt={Boolean(installEvt)}
              onInstall={installFromIntro}
              push={push}
              onEnablePush={pushFromIntro}
              onDone={finishIntro}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toastMsg && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] mx-auto w-fit max-w-[90vw] rounded-full bg-ink px-5 py-3 text-sm text-on-ink shadow-raise"
            >
              {toastMsg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SfContext.Provider>
  );
}

function isIosSafe() {
  return typeof navigator !== 'undefined' && isIos();
}

export type { SavedAccount };
