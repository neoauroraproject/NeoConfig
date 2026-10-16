'use client';

import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { relativeTime } from '@/lib/format';
import { Panel, adminApi } from './adminApi';
import { Button, Card, Empty, Field, PageHeader, StatusDot, errMsg } from './ui';

type Form = {
  name: string;
  type: 'xui' | 'pasarguard' | 'hmpanel';
  baseUrl: string;
  auth: 'password' | 'token';
  username: string;
  password: string;
  apiToken: string;
};

const EMPTY: Form = { name: '', type: 'xui', baseUrl: '', auth: 'password', username: '', password: '', apiToken: '' };

const TYPE_INFO = {
  xui: {
    label: '3x-ui (ثنایی)',
    urlHint: 'آدرس کامل پنل همراه با مسیر مخفی، مثل https://panel.example.com:2053/abc123',
    tokenHint: 'از Settings → Security → API Token در پنل ثنایی',
  },
  hmpanel: {
    label: 'HMPanel',
    urlHint: 'آدرس HMPanel، مثل https://panel.example.com',
    tokenHint: 'از HMPanel ← دسترسی API یک کلید hmp_ بساز. کلید نماینده فقط مشتری‌های همان نماینده را نشان می‌دهد.',
  },
  pasarguard: {
    label: 'PasarGuard',
    urlHint: 'آدرس پنل بدون /dashboard، مثل https://panel.example.com:8000',
    tokenHint: 'توکن دسترسی ادمین (اختیاری؛ نام کاربری و رمز کافی است)',
  },
};

export function Panels() {
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [editing, setEditing] = useState<Panel | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => adminApi.panels().then(setPanels).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    void load();
  }, []);

  async function test(p: Panel) {
    setTesting(p.id);
    try {
      const r = await adminApi.testPanel(p.id);
      const stats = r.stats
        ? ` · ${r.stats.clients ?? '?'} کاربر${r.stats.online !== null && r.stats.online !== undefined ? ` · ${r.stats.online} آنلاین` : ''}`
        : '';
      setResults((m) => ({ ...m, [p.id]: (r.ok ? 'اتصال برقرار است' : r.message) + (r.ok ? stats : '') }));
      await load();
    } catch (e) {
      setResults((m) => ({ ...m, [p.id]: errMsg(e) }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="اتصال پنل‌ها"
        subtitle="وقتی کاربر لینک اشتراک می‌زند، subId آن در این پنل‌ها جست‌وجو می‌شود."
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> افزودن پنل
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-[#d4373f]">{error}</p>}

      {editing && (
        <PanelForm
          panel={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={async (id) => {
            setEditing(null);
            await load();
            const p = (await adminApi.panels()).find((x) => x.id === id);
            if (p) void test(p);
          }}
        />
      )}

      {panels === null ? (
        <div className="h-32 animate-pulse rounded-2xl bg-[var(--surface)]" />
      ) : panels.length === 0 && !editing ? (
        <Empty
          title="هنوز پنلی وصل نشده"
          body="پنل ثنایی (3x-ui) یا پاسارگارد را وصل کن تا حجم و انقضای دقیق کاربران با subId پیدا شود."
          action={<Button onClick={() => setEditing('new')}>افزودن اولین پنل</Button>}
        />
      ) : (
        <div className="space-y-3">
          {panels.map((p) => (
            <Card key={p.id} className="!p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--surface-2)] text-xs font-semibold text-[var(--ink-2)]">
                  {p.type === 'pasarguard' ? 'PG' : p.type === 'hmpanel' ? 'HM' : 'X'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot ok={p.lastTestOk} />
                    <p className="truncate font-medium">{p.name}</p>
                    <span className="text-xs text-[var(--ink-3)]">{TYPE_INFO[p.type].label}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--ink-3)]" dir="ltr" style={{ textAlign: 'right' }}>
                    {p.baseUrl}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-2)]">
                    {results[p.id] ??
                      (p.lastTestAt
                        ? `${p.lastTestOk ? 'متصل' : p.lastTestMessage || 'ناموفق'} · ${relativeTime(p.lastTestAt, 'fa')}`
                        : 'هنوز تست نشده')}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="secondary" busy={testing === p.id} onClick={() => test(p)}>
                    <Zap className="h-4 w-4" /> تست اتصال
                  </Button>
                  <Button variant="ghost" aria-label={`ویرایش ${p.name}`} onClick={() => setEditing(p)} className="!px-3">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {confirmDelete === p.id ? (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        await adminApi.deletePanel(p.id).catch((e) => setError(errMsg(e)));
                        setConfirmDelete(null);
                        void load();
                      }}
                    >
                      حذف «{p.name}»
                    </Button>
                  ) : (
                    <Button variant="ghost" aria-label={`حذف ${p.name}`} onClick={() => setConfirmDelete(p.id)} className="!px-3">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelForm({
  panel,
  onCancel,
  onSaved,
}: {
  panel: Panel | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
}) {
  const [f, setF] = useState<Form>(
    panel
      ? { ...EMPTY, name: panel.name, type: panel.type, baseUrl: panel.baseUrl, auth: panel.authMode === 'bearer' ? 'token' : 'password' }
      : EMPTY,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const info = TYPE_INFO[f.type];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim() || info.label,
      type: f.type,
      baseUrl: f.baseUrl.trim().replace(/\/+$/, ''),
      ...(f.auth === 'token'
        ? { apiToken: f.apiToken.trim() || undefined }
        : { username: f.username.trim() || undefined, password: f.password || undefined }),
    };
    try {
      const saved = panel ? await adminApi.updatePanel(panel.id, body) : await adminApi.createPanel(body);
      onSaved(saved.id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit}>
        <h2 className="font-medium">{panel ? `ویرایش ${panel.name}` : 'پنل جدید'}</h2>
        <div className="mt-4 flex gap-2" role="radiogroup" aria-label="نوع پنل">
          {(['xui', 'pasarguard', 'hmpanel'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={f.type === t}
              onClick={() => setF((x) => ({ ...x, type: t, auth: t === 'hmpanel' ? 'token' : x.auth }))}
              className={`h-10 rounded-xl px-4 text-sm ${f.type === t ? 'bg-[var(--ink)] text-white' : 'border border-[var(--line)] text-[var(--ink-2)]'}`}
            >
              {TYPE_INFO[t].label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="نام" htmlFor="p-name" hint="فقط برای شما؛ به کاربر نشان داده نمی‌شود">
            <input id="p-name" className="field" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={info.label} />
          </Field>
          <Field label="آدرس پنل" htmlFor="p-url" hint={info.urlHint}>
            <input id="p-url" dir="ltr" required className="field" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://" />
          </Field>
        </div>
        <div className={`mt-4 flex gap-4 text-sm ${f.type === 'hmpanel' ? 'hidden' : ''}`}>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="auth" checked={f.auth === 'password'} onChange={() => set('auth', 'password')} /> نام کاربری و رمز
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="auth" checked={f.auth === 'token'} onChange={() => set('auth', 'token')} /> توکن API
          </label>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {f.auth === 'password' ? (
            <>
              <Field label="نام کاربری ادمین" htmlFor="p-user">
                <input id="p-user" dir="ltr" autoComplete="off" className="field" value={f.username} onChange={(e) => set('username', e.target.value)} required={!panel} />
              </Field>
              <Field label="رمز عبور" htmlFor="p-pass" hint={panel ? 'خالی بگذار تا رمز قبلی بماند' : 'رمزنگاری‌شده ذخیره می‌شود'}>
                <input id="p-pass" dir="ltr" type="password" autoComplete="new-password" className="field" value={f.password} onChange={(e) => set('password', e.target.value)} required={!panel} />
              </Field>
            </>
          ) : (
            <Field label={f.type === 'hmpanel' ? 'کلید API (hmp_…)' : 'توکن API'} htmlFor="p-token" hint={panel ? 'خالی بگذار تا توکن قبلی بماند' : info.tokenHint}>
              <input id="p-token" dir="ltr" autoComplete="off" className="field" value={f.apiToken} onChange={(e) => set('apiToken', e.target.value)} required={!panel} />
            </Field>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-[#d4373f]">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <Button type="submit" busy={busy}>
            {panel ? 'ذخیره تغییرات' : 'ذخیره و تست اتصال'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            انصراف
          </Button>
        </div>
      </form>
    </Card>
  );
}
