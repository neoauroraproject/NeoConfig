'use client';

import { Bell, BellOff, Check, Globe, LifeBuoy, Palette, Pencil, Plus, Share, ShoppingBag, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { SavedAccount } from '@/lib/accounts';
import type { ThemeId } from '@/lib/api';
import { THEME_SWATCH } from '@/lib/themes';
import { formatBytes } from '@/lib/format';
import type { Locale } from '@/lib/i18n';
import type { PushState } from '@/lib/push';
import { useSf } from './context';
import { Sheet } from './Sheet';

export function AccountsSheet({
  open,
  onClose,
  accounts,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  accounts: SavedAccount[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useSf();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setConfirming(null);
    }
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title={t('accounts')} closeLabel={t('close')}>
      <ul className="space-y-2">
        {accounts.map((a) => {
          const active = a.id === activeId;
          const name = a.label || a.snapshot.displayName;
          return (
            <li key={a.id} className={`rounded-3xl p-1 ${active ? 'bg-surface-2' : ''}`}>
              {editing === a.id ? (
                <form
                  className="flex items-center gap-2 p-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(a.id, draft.trim());
                    setEditing(null);
                  }}
                >
                  <label className="sr-only" htmlFor={`rename-${a.id}`}>
                    {t('rename')}
                  </label>
                  <input
                    id={`rename-${a.id}`}
                    data-autofocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={40}
                    className="h-11 flex-1 rounded-2xl bg-surface px-3 text-sm text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-[var(--brand)]"
                  />
                  <button type="submit" className="h-11 rounded-2xl bg-ink px-4 text-sm text-on-ink">
                    {t('save')}
                  </button>
                </form>
              ) : confirming === a.id ? (
                <div className="p-3">
                  <p className="text-sm text-ink">{t('removeConfirm')}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onRemove(a.id);
                        setConfirming(null);
                      }}
                      className="h-11 rounded-2xl bg-[#d4373f] px-4 text-sm text-white"
                    >
                      {t('removeYes')}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="h-11 rounded-2xl px-4 text-sm text-ink-2">
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-3xl p-2 text-start"
                    aria-current={active}
                  >
                    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${active ? 'bg-btn text-btn-ink' : 'bg-surface-2 text-ink-2'}`}>
                      {active ? <Check className="h-4 w-4" /> : name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{name}</span>
                      <span className="block truncate text-xs text-ink-2">
                        {t(`status_${a.snapshot.status}` as const)} ·{' '}
                        <span dir="ltr">
                          {a.snapshot.quotaKind === 'unlimited' ? '∞' : formatBytes(a.snapshot.remainingBytes)}
                        </span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('rename')} ${name}`}
                    onClick={() => {
                      setDraft(name);
                      setEditing(a.id);
                    }}
                    className="grid h-10 w-10 place-items-center rounded-full text-ink-2"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('remove')} ${name}`}
                    onClick={() => setConfirming(a.id)}
                    className="grid h-10 w-10 place-items-center rounded-full text-ink-2"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-3xl border border-dashed border-line text-sm font-medium text-ink"
      >
        <Plus className="h-4 w-4" />
        {t('addAnother')}
      </button>
    </Sheet>
  );
}

export function MenuSheet({
  open,
  onClose,
  locale,
  onLocale,
  push,
  onPushToggle,
  theme,
  themes,
  onTheme,
  onBuy,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  onLocale: (l: Locale) => void;
  push: PushState;
  onPushToggle: () => void;
  theme: ThemeId;
  themes: ThemeId[];
  onTheme: (t: ThemeId) => void;
  onBuy?: () => void;
}) {
  const { t, brand } = useSf();
  const support = brand.supportTelegram
    ? `https://t.me/${brand.supportTelegram.replace(/^@/, '')}`
    : brand.supportUrl || (brand.contactEmail ? `mailto:${brand.contactEmail}` : null);
  const pushText =
    push === 'on'
      ? t('notificationsOn')
      : push === 'denied'
        ? t('notificationsBlocked')
        : push === 'ios-needs-install'
          ? t('notificationsIos')
          : push === 'unsupported'
            ? t('notificationsBlocked')
            : t('notificationsOff');

  return (
    <Sheet open={open} onClose={onClose} title={brand.appName} closeLabel={t('close')}>
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-3xl bg-surface-2 p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2">
            {push === 'on' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{t('notifications')}</p>
            <p className="text-xs leading-5 text-ink-2">{pushText}</p>
          </div>
          {(push === 'on' || push === 'off') && (
            <button
              type="button"
              onClick={onPushToggle}
              className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium ${push === 'on' ? 'bg-surface text-ink' : 'bg-btn text-btn-ink'}`}
            >
              {push === 'on' ? t('disable') : t('enable')}
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 rounded-3xl bg-surface-2 p-4">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2">
            <Globe className="h-4 w-4" />
          </span>
          <p className="flex-1 text-sm font-medium text-ink">{t('language')}</p>
          <div className="flex rounded-full bg-surface p-1" role="group" aria-label={t('language')}>
            {(['fa', 'en'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLocale(l)}
                aria-pressed={locale === l}
                className={`h-9 rounded-full px-3.5 text-sm ${locale === l ? 'bg-ink text-on-ink' : 'text-ink-2'}`}
              >
                {l === 'fa' ? 'فارسی' : 'English'}
              </button>
            ))}
          </div>
        </div>

        {themes.length > 1 && (
          <div className="rounded-3xl bg-surface-2 p-4">
            <p className="mb-3 flex items-center gap-3 text-sm font-medium text-ink">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2">
                <Palette className="h-4 w-4" />
              </span>
              {t('theme')}
            </p>
            <div className="grid grid-cols-3 gap-2 tab:grid-cols-5" role="radiogroup" aria-label={t('theme')}>
              {themes.map((id) => {
                const sw = THEME_SWATCH[id];
                const on = id === theme;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onTheme(id)}
                    className={`press rounded-2xl p-1 text-center ${on ? 'ring-2 ring-[var(--ink)]' : ''}`}
                  >
                    <span className="relative flex h-14 items-end gap-1 overflow-hidden rounded-xl p-1.5" style={{ background: sw.canvas }}>
                      <span className="h-8 flex-1 rounded-md" style={{ background: sw.card, boxShadow: '0 0 0 1px rgba(127,127,127,.18) inset' }} />
                      <span className="h-5 w-5 rounded-md" style={{ background: sw.hi }} />
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-2">{locale === 'fa' ? sw.fa : sw.en}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {onBuy && (
          <button type="button" onClick={onBuy} className="flex w-full items-center gap-3 rounded-3xl bg-surface-2 p-4 text-start">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-btn text-btn-ink">
              <ShoppingBag className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-ink">{t('buyNew')}</span>
          </button>
        )}

        {support && (
          <a href={support} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-3xl bg-surface-2 p-4">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2">
              <LifeBuoy className="h-4 w-4" />
            </span>
            <span className="flex-1 text-sm font-medium text-ink">{t('support')}</span>
          </a>
        )}
      </div>
    </Sheet>
  );
}

export function QrSheet({ open, onClose, url }: { open: boolean; onClose: () => void; url: string }) {
  const { t } = useSf();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(url, { margin: 1, width: 560, errorCorrectionLevel: 'M' })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [open, url]);
  return (
    <Sheet open={open} onClose={onClose} title={t('qr')} closeLabel={t('close')}>
      <div className="mx-auto w-full max-w-[280px] rounded-4xl bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt={t('qr')} className="h-auto w-full" />}
      </div>
      <p className="mx-auto mt-4 max-w-[34ch] text-center text-sm leading-7 text-ink-2">{t('qrHint')}</p>
    </Sheet>
  );
}

export function InstallIosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useSf();
  return (
    <Sheet open={open} onClose={onClose} title={t('installIosTitle')} closeLabel={t('close')}>
      <div className="flex items-start gap-3 rounded-3xl bg-surface-2 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-[#0a84ff]">
          <Share className="h-4 w-4" />
        </span>
        <p className="text-sm leading-7 text-ink">{t('installIosSteps')}</p>
      </div>
      <button type="button" onClick={onClose} className="mt-4 h-14 w-full rounded-3xl bg-ink text-sm font-medium text-on-ink">
        {t('done')}
      </button>
    </Sheet>
  );
}
