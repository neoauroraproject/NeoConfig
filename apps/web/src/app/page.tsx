'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Settings2, Download } from 'lucide-react';
import { AddSubscriptionDialog } from '@/components/AddSubscriptionDialog';
import { SubscriptionCard } from '@/components/SubscriptionCard';
import { api, Branding, SubscriptionDto } from '@/lib/api';
import { getLocale, getToken, setLocale, setTheme, setToken, getTheme } from '@/lib/auth-store';
import { isRtl, Locale, t } from '@/lib/i18n';

export default function HomePage() {
  const [token, setTok] = useState<string | null>(null);
  const [locale, setLoc] = useState<Locale>('en');
  const [branding, setBranding] = useState<Branding | null>(null);
  const [subs, setSubs] = useState<SubscriptionDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [renewAvailable, setRenewAvailable] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTok(getToken());
    setLoc(getLocale());
    const theme = getTheme();
    applyTheme(theme);
    api.branding().then((b) => {
      setBranding(b);
      document.documentElement.style.setProperty('--brand-primary', b.primaryColor);
      document.documentElement.style.setProperty('--brand-accent', b.accentColor);
      if (theme === 'system') applyTheme(b.themeDefault === 'light' ? 'light' : 'dark');
    }).catch(() => undefined);

    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  useEffect(() => {
    if (!token) return;
    api
      .listSubscriptions(token)
      .then((rows) => {
        setSubs(rows);
        if (!activeId && rows[0]) setActiveId(rows[0].id);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  const active = useMemo(
    () => subs.find((s) => s.id === activeId) || subs[0] || null,
    [subs, activeId],
  );

  useEffect(() => {
    if (!token || !active) {
      setRenewAvailable(false);
      return;
    }
    api.renewal(token, active.id).then((r) => setRenewAvailable(r.available)).catch(() => setRenewAvailable(false));
  }, [token, active?.id]);

  if (!token) {
    return <AuthGate locale={locale} branding={branding} onAuthed={(tkn) => { setToken(tkn); setTok(tkn); }} onLocale={setLoc} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/20 text-sm font-bold text-brand">
              {(branding?.shortName || 'S').slice(0, 1)}
            </div>
          )}
          <div>
            <div className="font-display text-base font-semibold">
              {branding?.appName || t(locale, 'appFallback')}
            </div>
            <div className="muted text-xs">Subscription</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {installPrompt && (
            <button
              type="button"
              className="rounded-xl p-2"
              aria-label={t(locale, 'installApp')}
              onClick={async () => {
                await installPrompt.prompt();
                setInstallPrompt(null);
              }}
            >
              <Download className="h-5 w-5" />
            </button>
          )}
          <button type="button" className="rounded-xl p-2" onClick={() => setAddOpen(true)} aria-label={t(locale, 'addSubscription')}>
            <Plus className="h-5 w-5" />
          </button>
          <button type="button" className="rounded-xl p-2" onClick={() => setSettingsOpen((v) => !v)} aria-label={t(locale, 'settings')}>
            <Settings2 className="h-5 w-5" />
          </button>
        </div>
      </header>

      {subs.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {subs.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveId(s.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                active?.id === s.id ? 'bg-brand text-white' : 'surface'
              }`}
            >
              {s.displayName}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-rose-300">{error}</p>}

      {!active ? (
        <section className="surface flex flex-1 flex-col items-center justify-center rounded-3xl p-8 text-center">
          <h1 className="font-display text-xl font-semibold">{t(locale, 'emptyTitle')}</h1>
          <p className="muted mt-2 max-w-xs text-sm">{t(locale, 'emptyBody')}</p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-6 rounded-2xl bg-brand px-5 py-2.5 text-sm font-medium text-white"
          >
            {t(locale, 'addSubscription')}
          </button>
          <p className="muted mt-6 text-xs">{t(locale, 'iosInstall')}</p>
        </section>
      ) : (
        <SubscriptionCard
          sub={active}
          locale={locale}
          supportUrl={branding?.supportUrl}
          renewAvailable={renewAvailable}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              const updated = await api.refreshSubscription(token, active.id);
              setSubs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Refresh failed');
            } finally {
              setRefreshing(false);
            }
          }}
          onDelete={async () => {
            await api.deleteSubscription(token, active.id);
            setSubs((prev) => prev.filter((s) => s.id !== active.id));
            setActiveId(null);
          }}
        />
      )}

      {settingsOpen && (
        <section className="surface mt-4 rounded-3xl p-4 text-sm">
          <div className="mb-3 font-medium">{t(locale, 'settings')}</div>
          <label className="muted mb-1 block text-xs">{t(locale, 'language')}</label>
          <select
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
            value={locale}
            onChange={(e) => {
              const v = e.target.value as Locale;
              setLocale(v);
              setLoc(v);
            }}
          >
            <option value="en">English</option>
            <option value="fa">فارسی</option>
            <option value="ar">العربية</option>
          </select>
          <label className="muted mb-1 block text-xs">{t(locale, 'theme')}</label>
          <select
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
            defaultValue={getTheme()}
            onChange={(e) => {
              const v = e.target.value as 'dark' | 'light' | 'system';
              setTheme(v);
              applyTheme(v);
            }}
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin" className="text-brand">{t(locale, 'admin')}</Link>
            <button
              type="button"
              className="text-rose-300"
              onClick={() => {
                setToken(null);
                setTok(null);
              }}
            >
              {t(locale, 'logout')}
            </button>
          </div>
        </section>
      )}

      <AddSubscriptionDialog
        locale={locale}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={async (url, displayName) => {
          const created = await api.createSubscription(token, { url, displayName });
          setSubs((prev) => [...prev, created]);
          setActiveId(created.id);
        }}
      />
    </main>
  );
}

function AuthGate({
  locale,
  branding,
  onAuthed,
  onLocale,
}: {
  locale: Locale;
  branding: Branding | null;
  onAuthed: (token: string) => void;
  onLocale: (l: Locale) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <div className="surface rounded-3xl p-6 shadow-soft">
        <h1 className="font-display text-2xl font-semibold">
          {branding?.appName || t(locale, 'appFallback')}
        </h1>
        <p className="muted mt-2 text-sm">{t(locale, 'emptyBody')}</p>
        <input
          className="mt-6 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          placeholder={t(locale, 'email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
        />
        <input
          type="password"
          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          placeholder={t(locale, 'password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
        />
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <button
          type="button"
          disabled={busy}
          className="mt-5 w-full rounded-2xl bg-brand py-3 text-sm font-medium text-white disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res =
                mode === 'login'
                  ? await api.login(email, password)
                  : await api.register(email, password);
              onAuthed(res.accessToken);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === 'login' ? t(locale, 'login') : t(locale, 'register')}
        </button>
        <button
          type="button"
          className="muted mt-3 w-full text-xs"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t(locale, 'register') : t(locale, 'login')}
        </button>
        <div className="mt-4 flex justify-center gap-2 text-xs">
          {(['en', 'fa', 'ar'] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              className={locale === l ? 'text-brand' : 'muted'}
              onClick={() => {
                setLocale(l);
                onLocale(l);
              }}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
