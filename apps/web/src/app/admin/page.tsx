'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth-store';

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [panels, setPanels] = useState<Array<Record<string, unknown>>>([]);
  const [servers, setServers] = useState<Array<Record<string, unknown>>>([]);
  const [hmpanel, setHmpanel] = useState<Record<string, unknown> | null>(null);
  const [branding, setBranding] = useState<Record<string, unknown> | null>(null);
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [panelForm, setPanelForm] = useState({
    name: 'Main panel',
    baseUrl: '',
    apiToken: '',
  });
  const [brandName, setBrandName] = useState('');

  useEffect(() => {
    const tkn = getToken();
    setToken(tkn);
    if (!tkn) return;
    Promise.all([
      api.adminOverview(tkn),
      api.listPanels(tkn),
      api.listServers(tkn),
      api.hmpanel(tkn),
      api.adminBranding(tkn),
    ])
      .then(([ov, p, s, h, b]) => {
        setOverview(ov as Record<string, unknown>);
        setPanels(p as Array<Record<string, unknown>>);
        setServers(s as Array<Record<string, unknown>>);
        setHmpanel(h as Record<string, unknown>);
        setBranding(b as Record<string, unknown>);
        setBrandName(String((b as { appName?: string }).appName || ''));
      })
      .catch((err) => setMessage(err.message));
  }, []);

  if (!token) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p>Sign in required. <Link href="/" className="text-brand">Back</Link></p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Admin</h1>
        <Link href="/" className="text-sm text-brand">User app</Link>
      </div>
      {message && <p className="text-sm text-amber-300">{message}</p>}

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">Overview</h2>
        {overview && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Users" value={String(overview.users)} />
            <Stat label="Servers" value={String(overview.servers)} />
            <Stat label="Online" value={String(overview.serversOnline)} />
            <Stat label="Failed syncs" value={String(overview.failedSyncs)} />
          </div>
        )}
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">Branding</h2>
        <input
          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
        />
        <button
          type="button"
          className="mt-3 rounded-2xl bg-brand px-4 py-2 text-sm text-white"
          onClick={async () => {
            const b = await api.updateBranding(token, { appName: brandName, shortName: brandName });
            setBranding(b as unknown as Record<string, unknown>);
            setMessage('Branding saved');
          }}
        >
          Save branding
        </button>
        {branding && (
          <p className="muted mt-2 text-xs">Theme default: {String(branding.themeDefault)}</p>
        )}
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">3x-ui panel</h2>
        <p className="muted mt-1 text-xs">
          Uses docs/api310.json contract. Credentials stay encrypted server-side.
        </p>
        <input
          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          placeholder="Panel name"
          value={panelForm.name}
          onChange={(e) => setPanelForm({ ...panelForm, name: e.target.value })}
        />
        <input
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          placeholder="https://panel.example.com/webBasePath"
          dir="ltr"
          value={panelForm.baseUrl}
          onChange={(e) => setPanelForm({ ...panelForm, baseUrl: e.target.value })}
        />
        <input
          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm"
          placeholder="API token (Bearer)"
          dir="ltr"
          value={panelForm.apiToken}
          onChange={(e) => setPanelForm({ ...panelForm, apiToken: e.target.value })}
        />
        <button
          type="button"
          className="mt-3 rounded-2xl bg-brand px-4 py-2 text-sm text-white"
          onClick={async () => {
            await api.createPanel(token, panelForm);
            setPanels((await api.listPanels(token)) as Array<Record<string, unknown>>);
            setMessage('Panel saved');
            setPanelForm({ name: 'Main panel', baseUrl: '', apiToken: '' });
          }}
        >
          Add panel
        </button>
        <ul className="mt-4 space-y-2 text-sm">
          {panels.map((p) => (
            <li key={String(p.id)} className="flex items-center justify-between rounded-2xl bg-black/10 px-3 py-2">
              <span>{String(p.name)}</span>
              <button
                type="button"
                className="text-brand"
                onClick={async () => {
                  const r = (await api.testPanel(token, String(p.id))) as { ok: boolean; message: string };
                  setMessage(r.ok ? 'Panel OK' : r.message);
                }}
              >
                Test
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">Server agent (one-line install)</h2>
        <button
          type="button"
          className="mt-3 rounded-2xl bg-brand px-4 py-2 text-sm text-white"
          onClick={async () => {
            const res = await api.createServer(token, `server-${Date.now().toString(36)}`);
            setInstallCmd(res.installCommand);
            setMessage(res.warning);
            setServers((await api.listServers(token)) as Array<Record<string, unknown>>);
          }}
        >
          Register server & generate install command
        </button>
        {installCmd && (
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/30 p-3 text-xs" dir="ltr">
            {installCmd}
          </pre>
        )}
        <ul className="mt-4 space-y-2 text-sm">
          {servers.map((s) => (
            <li key={String(s.id)} className="rounded-2xl bg-black/10 px-3 py-2">
              {String(s.name)} · {String(s.status)} · {String(s.hostname || '—')}
            </li>
          ))}
        </ul>
      </section>

      <section className="surface rounded-3xl p-5">
        <h2 className="font-medium">HMPanel renewal</h2>
        <p className="muted mt-2 text-sm">
          {String(hmpanel?.lastTestMessage || 'Unconfigured')}
        </p>
        <p className="mt-2 text-xs">
          Configured: {String(hmpanel?.configured ?? false)} · Renewal capability disabled until a verified API contract is supplied.
        </p>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/10 px-3 py-3">
      <div className="muted text-xs">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
