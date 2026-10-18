'use client';

import { BadgeCheck, LayoutGrid, LogOut, Menu, Palette, PlugZap, Users, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { Me, adminApi, getToken, setToken } from './adminApi';
import { Brands } from './Brands';
import { OverviewPage } from './Overview';
import { Panels } from './Panels';
import { Renewals } from './Renewals';
import { Team } from './Team';
import { Button, Field, errMsg } from './ui';

export type Section = 'overview' | 'brands' | 'panels' | 'renewals' | 'team';

const NAV: Array<{ id: Section; label: string; icon: typeof LayoutGrid; adminOnly?: boolean }> = [
  { id: 'overview', label: 'داشبورد', icon: LayoutGrid },
  { id: 'renewals', label: 'تمدیدها', icon: BadgeCheck },
  { id: 'brands', label: 'برندها', icon: Palette },
  { id: 'panels', label: 'اتصال پنل‌ها', icon: PlugZap, adminOnly: true },
  { id: 'team', label: 'تیم فروش', icon: Users, adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'مالک',
  ORG_ADMIN: 'مدیر',
  RESELLER: 'نماینده فروش',
};

export function AdminApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState<Section>('overview');
  const [drawer, setDrawer] = useState(false);
  const [pending, setPending] = useState(0);
  const lastLatest = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    document.documentElement.lang = 'fa';
    document.documentElement.dir = 'rtl';
    const hash = window.location.hash.slice(1) as Section;
    if (NAV.some((n) => n.id === hash)) setSection(hash);
    if (!getToken()) {
      setChecking(false);
      return;
    }
    adminApi
      .me()
      .then((u) => setMe(u))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  // New receipts show up in the menu within ~20s, with a soft chime and the count in the tab title.
  useEffect(() => {
    if (!me) return;
    let stop = false;
    const poll = () =>
      adminApi
        .pendingRenewals()
        .then((r) => {
          if (stop) return;
          setPending(r.count);
          if (lastLatest.current !== undefined && r.latestAt && r.latestAt !== lastLatest.current) chime();
          lastLatest.current = r.latestAt;
        })
        .catch(() => undefined);
    void poll();
    const id = setInterval(poll, 20_000);
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);
    return () => {
      stop = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [me]);

  useEffect(() => {
    document.title = pending > 0 ? `(${pending}) مدیریت NeoConfig` : 'مدیریت NeoConfig';
  }, [pending]);

  function go(s: Section) {
    setSection(s);
    setDrawer(false);
    history.replaceState(null, '', `#${s}`);
    window.scrollTo({ top: 0 });
  }

  function logout() {
    setToken(null);
    setMe(null);
  }

  if (checking) return <div className="adm min-h-dvh" />;
  if (!me || me.role === 'USER') return <Login onDone={setMe} />;

  const isAdmin = me.role !== 'RESELLER';
  const nav = NAV.filter((n) => isAdmin || !n.adminOnly);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4" aria-label="بخش‌ها">
      <div className="mb-6 flex items-center gap-3 px-2">
        <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="18" fill="none" stroke="var(--brand)" strokeWidth="2.2" />
          <circle cx="20" cy="23" r="12" fill="none" stroke="var(--brand)" strokeWidth="2.2" />
          <circle cx="20" cy="26.5" r="6.5" fill="var(--brand)" />
        </svg>
        <div>
          <p className="text-sm font-semibold">NeoConfig</p>
          <p className="text-xs text-[var(--ink-3)]">{ROLE_LABEL[me.role] ?? me.role}</p>
        </div>
      </div>
      {nav.map((n) => {
        const Icon = n.icon;
        const active = section === n.id;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => go(n.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition ${
              active ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-2)]'
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
            <span className="flex-1 text-start">{n.label}</span>
            {n.id === 'renewals' && pending > 0 && (
              <span className="relative flex items-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#e5484d] opacity-40" />
                <span className="num relative grid h-5 min-w-5 place-items-center rounded-full bg-[#e5484d] px-1.5 text-[11px] text-white">
                  {pending > 99 ? '99+' : pending}
                </span>
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto border-t border-[var(--line)] pt-4">
        <p className="truncate px-3 text-xs text-[var(--ink-3)]" dir="ltr">
          {me.email}
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-2 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-[var(--ink-2)] hover:bg-[var(--surface-2)]"
        >
          <LogOut className="h-4 w-4" />
          خروج
        </button>
      </div>
    </nav>
  );

  return (
    <div className="adm min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-e border-[var(--line)] bg-[var(--surface)] lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-4 lg:hidden">
        <button type="button" aria-label={pending ? `منو — ${pending} رسید در انتظار` : 'منو'} onClick={() => setDrawer(true)} className="relative grid h-10 w-10 place-items-center rounded-xl">
          <Menu className="h-5 w-5" />
          {pending > 0 && <span className="absolute end-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[#e5484d] ring-2 ring-[var(--surface)]" />}
        </button>
        <p className="text-sm font-semibold">{nav.find((n) => n.id === section)?.label}</p>
        <span className="w-10" />
      </header>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="منو">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 w-72 bg-[var(--surface)]">
            <button type="button" aria-label="بستن" onClick={() => setDrawer(false)} className="absolute end-3 top-3 grid h-10 w-10 place-items-center rounded-xl">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {section === 'overview' && <OverviewPage go={go} isAdmin={isAdmin} />}
        {section === 'renewals' && <Renewals />}
        {section === 'brands' && <Brands isAdmin={isAdmin} />}
        {section === 'panels' && isAdmin && <Panels />}
        {section === 'team' && isAdmin && <Team />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.login(email.trim(), password);
      if (res.user.role === 'USER') {
        setError('این حساب دسترسی مدیریت ندارد.');
        return;
      }
      setToken(res.accessToken);
      onDone(res.user);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'ایمیل یا رمز عبور درست نیست.' : errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7">
        <h1 className="text-xl font-semibold">ورود به پنل مدیریت</h1>
        <p className="mt-1 text-sm text-[var(--ink-2)]">برندها، اتصال پنل‌ها و تمدیدها را از اینجا مدیریت کن.</p>
        <div className="mt-6 space-y-4">
          <Field label="ایمیل" htmlFor="email">
            <input id="email" dir="ltr" type="email" autoComplete="username" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="رمز عبور" htmlFor="password">
            <input
              id="password"
              dir="ltr"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-[#d4373f]">
            {error}
          </p>
        )}
        <Button type="submit" busy={busy} className="mt-6 h-11 w-full">
          ورود
        </Button>
      </form>
    </div>
  );
}

/** A short two-note chime for a new receipt (silent if the browser blocks audio). */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* no audio */
  }
}
