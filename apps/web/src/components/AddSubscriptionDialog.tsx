'use client';

import { useState } from 'react';
import { Locale, t } from '@/lib/i18n';

type Props = {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  onSave: (url: string, displayName?: string) => Promise<void>;
};

export function AddSubscriptionDialog({ locale, open, onClose, onSave }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="surface w-full max-w-md rounded-3xl p-5 shadow-soft">
        <h2 className="font-display text-lg font-semibold">{t(locale, 'addSubscription')}</h2>
        <p className="muted mt-1 text-sm">{t(locale, 'pasteLink')}</p>
        <input
          className="mt-4 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none ring-brand focus:ring-2"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          dir="ltr"
        />
        <input
          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none ring-brand focus:ring-2"
          placeholder={t(locale, 'appFallback')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-2xl px-4 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !url.trim()}
            className="rounded-2xl bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSave(url.trim(), name.trim() || undefined);
                setUrl('');
                setName('');
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {t(locale, 'save')}
          </button>
        </div>
      </div>
    </div>
  );
}
