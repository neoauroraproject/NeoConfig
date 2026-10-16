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
import { ApiError, Branding, LookupResponse, PublicRenewal, publicApi } from '@/lib/api';
import { Locale, isRtl } from '@/lib/i18n';
import { PushState, disablePush, enablePush, followsOf, isIos, isStandalone, pushState, syncPush } from '@/lib/push';
import { demoHistory, demoLookup } from './demo';
import { Dashboard } from './Dashboard';
import { Onboarding } from './Onboarding';
import { RenewSheet } from './RenewSheet';
import { AccountsSheet, InstallIosSheet, MenuSheet, QrSheet } from './Sheets';
import { SfContext, brandStyle, makeT } from './context';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type SheetName = 'accounts' | 'menu' | 'qr' | 'renew' | 'install' | null;

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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [push, setPush] = useState<PushState>('unsupported');
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

  // ---------- boot ----------
  useEffect(() => {
    try {
      const saved = localStorage.getItem('nc.locale');
      if (saved === 'fa' || saved === 'en') setLocale(saved);
    } catch {
      /* ignore */
    }
    const s = loadAccounts(storeKey);
    setState(s);
    setTracked(loadRenewals(storeKey));
    setReady(true);
    setStandalone(isStandalone());
    if (!demo && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    void pushState().then((p) => {
      setPush(p);
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
        .then((rows) => !stop && setRenewals(rows))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
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

  async function refreshAll(s: AccountState) {
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

  function changeLocale(l: Locale) {
    setLocale(l);
    try {
      localStorage.setItem('nc.locale', l);
    } catch {
      /* ignore */
    }
  }

  const ctx = { brand, tenant, locale, t, toast, preview: demo };
  const canInstall = !standalone && (Boolean(installEvt) || isIosSafe());
  // Pending requests stay visible; decided ones show for three days.
  const accountRenewals = active
    ? renewals.filter(
        (r) =>
          (r.subId === active.id || tracked.some((x) => x.id === r.id && x.accountId === active.id)) &&
          (r.status === 'pending' || Date.now() - new Date(r.decidedAt ?? r.createdAt).getTime() < 3 * 86_400_000),
      )
    : [];

  return (
    <SfContext.Provider value={ctx}>
      <div data-theme={brand.theme} className="sf min-h-dvh" style={brandStyle(brand)} dir={isRtl(locale) ? 'rtl' : 'ltr'} lang={locale}>
        {!ready ? (
          <div className="min-h-dvh" />
        ) : !active || adding ? (
          <div className="mx-auto w-full max-w-[440px]">
            <Onboarding
              busy={busy}
              error={error}
              onSubmit={addAccount}
              canInstall={canInstall}
              onInstall={install}
              onCancel={adding && active ? () => (setAdding(false), setError(null)) : undefined}
            />
          </div>
        ) : (
          <Dashboard
            account={active}
            accountCount={state.accounts.length}
            refreshing={refreshing}
            renewals={accountRenewals}
            onRefresh={refreshActive}
            onCopy={async () => {
              try {
                await navigator.clipboard.writeText(active.url);
                toast(t('copied'));
              } catch {
                toast(t('err_generic'));
              }
            }}
            onQr={() => setSheet('qr')}
            onRenew={() => setSheet('renew')}
            onAccounts={() => setSheet('accounts')}
            onAdd={() => {
              setError(null);
              setAdding(true);
            }}
            onMenu={() => setSheet('menu')}
          />
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
            <RenewSheet
              open={sheet === 'renew'}
              onClose={() => setSheet(null)}
              subUrl={active.url}
              push={push}
              onEnablePush={togglePush}
              onSubmitted={(r) => {
                const next = [...tracked, { id: r.id, accountId: active.id }];
                setTracked(next);
                saveRenewals(storeKey, next);
              }}
            />
          </>
        )}
        <MenuSheet
          open={sheet === 'menu'}
          onClose={() => setSheet(null)}
          locale={locale}
          onLocale={changeLocale}
          push={push}
          onPushToggle={togglePush}
        />
        <InstallIosSheet open={sheet === 'install'} onClose={() => setSheet(null)} />

        <AnimatePresence>
          {toastMsg && (
            <motion.div
              role="status"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[60] mx-auto w-fit max-w-[90vw] rounded-full bg-ink px-5 py-3 text-sm text-surface shadow-raise"
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
