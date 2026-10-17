'use client';

import { useMemo, useState } from 'react';
import type { SavedAccount } from '@/lib/accounts';
import type { Branding } from '@/lib/api';
import { Dashboard } from '../storefront/Dashboard';
import { Onboarding } from '../storefront/Onboarding';
import { SfContext, brandStyle, makeT } from '../storefront/context';
import { demoHistory } from '../storefront/demo';

const GB = 1024 ** 3;

function sampleAccount(): SavedAccount {
  const used = 18.4 * GB;
  return {
    id: 'preview',
    url: 'https://example.com/sub/preview',
    label: null,
    online: true,
    lastOnlineAt: null,
    renewable: true,
    addedAt: new Date().toISOString(),
    history: demoHistory(used),
    snapshot: {
      subscriptionId: 'preview',
      displayName: 'سرویس نمونه',
      status: 'active',
      uploadBytes: used * 0.2,
      downloadBytes: used * 0.8,
      totalUsedBytes: used,
      quotaBytes: 50 * GB,
      remainingBytes: 50 * GB - used,
      quotaKind: 'known',
      expiryAt: new Date(Date.now() + 17 * 86_400_000).toISOString(),
      expiryKind: 'known',
      enabled: true,
      dataSource: 'preview',
      syncState: 'ok',
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
    },
  };
}

/** The real storefront components inside a phone frame, fed by the unsaved draft. */
export function PhonePreview({ brand }: { brand: Branding }) {
  const [screen, setScreen] = useState<'dash' | 'login'>('dash');
  const account = useMemo(sampleAccount, []);
  const locale = brand.defaultLocale === 'en' ? 'en' : 'fa';
  const noop = () => undefined;

  return (
    <div>
      <div className="mb-3 flex justify-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1">
        {(
          [
            ['dash', 'داشبورد کاربر'],
            ['login', 'صفحه ورود'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={screen === id}
            onClick={() => setScreen(id)}
            className={`h-8 flex-1 rounded-lg text-xs ${screen === id ? 'bg-[var(--ink)] text-white' : 'text-[var(--ink-2)]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mx-auto w-[300px] rounded-[2.75rem] bg-[#111] p-2.5 shadow-2xl">
        {/* transform makes fixed-position children (bottom nav) stay inside the frame */}
        <div
          className="relative h-[600px] overflow-y-auto overflow-x-hidden rounded-[2.25rem] scrollbar-none"
          style={{ transform: 'translateZ(0)' }}
        >
          <div style={{ width: 375, zoom: 280 / 375 }}>
            <SfContext.Provider value={{ brand, tenant: 'preview', locale, t: makeT(locale), toast: noop, preview: true }}>
              <div data-theme={brand.theme} className="sf" style={{ ...brandStyle(brand), minHeight: 806 }} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
                {screen === 'dash' ? (
                  <Dashboard
                    account={account}
                    accountCount={2}
                    refreshing={false}
                    renewals={[]}
                    onRefresh={noop}
                    onApps={noop}
                    onInfo={noop}
                    onQr={noop}
                    onRenew={noop}
                    onAccounts={noop}
                    onAdd={noop}
                    onMenu={noop}
                  />
                ) : (
                  <Onboarding busy={false} error={null} onSubmit={noop} canInstall onInstall={noop} />
                )}
              </div>
            </SfContext.Provider>
          </div>
        </div>
      </div>
    </div>
  );
}
