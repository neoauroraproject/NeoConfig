'use client';

import { SubscriptionCard } from '@/components/SubscriptionCard';
import { SubscriptionDto } from '@/lib/api';

const demoSub: SubscriptionDto = {
  id: 'demo',
  displayName: 'اشتراک پریمیوم',
  color: null,
  subIdHint: 'neo-premium',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  snapshot: {
    status: 'active',
    uploadBytes: 8_589_934_592,
    downloadBytes: 37_057_011_712,
    totalUsedBytes: 45_646_946_304,
    quotaBytes: 107_374_182_400,
    remainingBytes: 61_727_236_096,
    quotaKind: 'known',
    expiryAt: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
    expiryKind: 'known',
    enabled: true,
    dataSource: 'demo',
    syncState: 'ok',
    lastSyncAt: new Date().toISOString(),
    lastSyncError: null,
  },
};

export default function DemoPage() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-10 pt-6"
      dir="rtl"
      lang="fa"
    >
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/20 text-sm font-bold text-brand">
            N
          </div>
          <div>
            <div className="font-display text-base font-semibold">NeoConfig</div>
            <div className="muted text-xs">نمایش اشتراک</div>
          </div>
        </div>
      </header>
      <SubscriptionCard
        sub={demoSub}
        locale="fa"
        supportUrl="https://example.com/support"
        renewAvailable={false}
        onRefresh={() => undefined}
        onDelete={() => undefined}
      />
    </main>
  );
}
