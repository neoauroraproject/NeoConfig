'use client';

import { motion } from 'framer-motion';
import { Activity, ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NetworkStatus, publicApi } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useSf } from './context';
import { Sheet } from './Sheet';

type Tone = 'ok' | 'issue' | 'down' | 'maint' | 'unknown';

const TONE_COLOR: Record<Tone, string> = {
  ok: '#1fa66a',
  issue: '#e59a12',
  down: '#d4373f',
  maint: '#3b82f6',
  unknown: '#8a8f98',
};

const STATE_COLOR: Record<string, string> = {
  up: TONE_COLOR.ok,
  down: TONE_COLOR.down,
  pending: TONE_COLOR.issue,
  maintenance: TONE_COLOR.maint,
  paused: TONE_COLOR.unknown,
  unknown: TONE_COLOR.unknown,
};

/** u / d / p / m in the history strip. */
const HISTORY_COLOR: Record<string, string> = {
  u: TONE_COLOR.ok,
  d: TONE_COLOR.down,
  p: TONE_COLOR.issue,
  m: TONE_COLOR.maint,
};

function flag(country: string | null) {
  if (!country) return '🌐';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const DEMO_STATUS: NetworkStatus = {
  enabled: true,
  overall: 'degraded',
  updatedAt: Date.now() - 60_000,
  groups: [
    {
      name: 'Tunnels',
      monitors: [
        { name: 'DE2', country: 'de', status: 'up', latencyMs: 92, uptime24h: 0.9995, uptime30d: 0.9981, history: 'uuuuuuuuuuuuduuuuuuuuuuuuuuuuuuuuuuuuuuu'.split('') },
        { name: 'NL1', country: 'nl', status: 'down', latencyMs: null, uptime24h: 0.962, uptime30d: 0.993, history: 'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuddddd'.split('') },
        { name: 'TR1', country: 'tr', status: 'up', latencyMs: 61, uptime24h: 1, uptime30d: 0.9997, history: 'uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu'.split('') },
      ],
    },
  ],
  incidents: [{ title: 'NL1 unreachable', message: 'سرور هلند در حال بررسی است؛ تا رفع مشکل از سرورهای دیگر استفاده کنید.', status: 'investigating', at: Date.now() - 20 * 60_000 }],
  maintenance: [],
};

/** One word for the whole network: NeoUptime's own verdict, checked against the monitors. */
export function networkTone(s: NetworkStatus): { tone: Tone; down: number } {
  const monitors = s.groups.flatMap((g) => g.monitors);
  const down = monitors.filter((m) => m.status === 'down').length;
  const o = s.overall.toLowerCase();
  if (s.maintenance.length && !down && !s.incidents.length) return { tone: 'maint', down };
  if (/outage|major|down/.test(o) || (monitors.length && down === monitors.length)) return { tone: 'down', down };
  if (down || s.incidents.length || /degrad|partial|issue/.test(o)) return { tone: 'issue', down };
  if (/maint/.test(o)) return { tone: 'maint', down };
  if (/operational|ok|up/.test(o) || monitors.length) return { tone: 'ok', down };
  return { tone: 'unknown', down };
}

/** The small network box under the header; a tap opens every server's state. */
export function NetworkStatusBox() {
  const { brand, tenant, t, locale } = useSf();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [open, setOpen] = useState(false);
  const enabled = Boolean(brand.networkStatus);

  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    // The demo page shows a sample network (one server down) instead of calling a server.
    if (tenant.startsWith('demo-')) {
      setStatus(DEMO_STATUS);
      return;
    }
    const load = () =>
      publicApi
        .networkStatus(tenant)
        .then((s) => !stop && setStatus(s.enabled ? s : null))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [enabled, tenant]);

  if (!enabled || !status) return null;
  const { tone, down } = networkTone(status);
  const fmt = (n: number) => n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
  const label =
    tone === 'ok'
      ? t('net_ok')
      : tone === 'maint'
        ? t('net_maint')
        : tone === 'unknown'
          ? t('net_unknown')
          : down
            ? t('net_issueCount').replace('{n}', fmt(down))
            : t('net_issue');
  const Chevron = locale === 'fa' ? ChevronLeft : ChevronRight;
  const pct = locale === 'fa' ? '٪' : '%';

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-5 flex w-full items-center gap-3 rounded-3xl bg-surface px-4 py-3 text-start shadow-raise-sm"
        aria-label={`${t('net_title')}: ${label}`}
      >
        <span className="relative grid h-3 w-3 place-items-center">
          {tone !== 'ok' && tone !== 'unknown' && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: TONE_COLOR[tone] }} />
          )}
          <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-ink-3">{t('net_title')}</span>
          <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        </span>
        {tone === 'maint' ? <Wrench className="h-4 w-4 text-ink-3" /> : <Activity className="h-4 w-4 text-ink-3" />}
        <Chevron className="h-4 w-4 text-ink-3" />
      </motion.button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('net_title')} closeLabel={t('close')}>
        <div className="flex items-center gap-3 rounded-3xl p-4 text-white" style={{ background: TONE_COLOR[tone] }}>
          <Activity className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{label}</p>
            {status.updatedAt && (
              <p className="text-xs opacity-85">
                {t('net_updated')} {relativeTime(new Date(status.updatedAt).toISOString(), locale)}
                {status.stale ? ` · ${t('net_stale')}` : ''}
              </p>
            )}
          </div>
        </div>

        {[
          { title: t('net_incidents'), items: status.incidents, color: TONE_COLOR.issue },
          { title: t('net_maintenance'), items: status.maintenance, color: TONE_COLOR.maint },
        ]
          .filter((s) => s.items.length)
          .map((s) => (
            <section key={s.title} className="mt-4">
              <h3 className="mb-2 text-[13px] font-medium text-ink-2">{s.title}</h3>
              <ul className="space-y-2">
                {s.items.map((n, i) => (
                  <li key={i} className="rounded-3xl bg-surface-2 p-4" style={{ borderInlineStart: `3px solid ${s.color}` }}>
                    <p className="text-sm font-medium text-ink">{n.title}</p>
                    {n.message && <p className="mt-1 text-[13px] leading-6 text-ink-2">{n.message}</p>}
                    {n.at && <p className="mt-1 text-[11px] text-ink-3">{relativeTime(new Date(n.at).toISOString(), locale)}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}

        {status.groups.map((g) => (
          <section key={g.name} className="mt-4">
            {g.name && <h3 className="mb-2 text-[13px] font-medium text-ink-2">{g.name}</h3>}
            <ul className="divide-y divide-line rounded-3xl bg-surface-2 px-4">
              {g.monitors.map((m) => (
                <li key={m.name} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg leading-none" aria-hidden>
                      {flag(m.country)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" dir="ltr">
                      {m.name}
                    </span>
                    {m.latencyMs !== null && m.status === 'up' && (
                      <span className="num text-xs text-ink-3" dir="ltr">
                        {fmt(Math.round(m.latencyMs))} ms
                      </span>
                    )}
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
                      style={{ background: STATE_COLOR[m.status] ?? TONE_COLOR.unknown }}
                    >
                      {t(`net_state_${m.status}` as Parameters<typeof t>[0])}
                    </span>
                  </div>
                  {m.history.length > 0 && (
                    <div className="mt-2 flex h-5 items-end gap-[2px]" dir="ltr" aria-hidden>
                      {m.history.slice(-40).map((h, i) => (
                        <span key={i} className="h-full flex-1 rounded-[2px]" style={{ background: HISTORY_COLOR[h] ?? TONE_COLOR.unknown, opacity: 0.85 }} />
                      ))}
                    </div>
                  )}
                  {m.uptime24h !== null && (
                    <p className="mt-1.5 text-[11px] text-ink-3">
                      {t('net_uptime24h')}: <span className="num">{fmt(Math.round(m.uptime24h * 10_000) / 100)}{pct}</span>
                      {m.uptime30d !== null && (
                        <>
                          {' · '}
                          {t('net_uptime30d')}: <span className="num">{fmt(Math.round(m.uptime30d * 10_000) / 100)}{pct}</span>
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Sheet>
    </>
  );
}
