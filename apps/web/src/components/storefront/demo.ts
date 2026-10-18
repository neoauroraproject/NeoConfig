import type { LookupResponse } from '@/lib/api';
import { localDay, type SavedAccount } from '@/lib/accounts';

const GB = 1024 ** 3;

/** Deterministic fake account so the storefront can be previewed without panels. */
export function demoLookup(url: string): Promise<LookupResponse> {
  const seed = [...url].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const quota = (seed % 2 ? 50 : 30) * GB;
  const used = ((seed % 70) / 100 + 0.12) * quota;
  const days = 4 + (seed % 26);
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          subId: `demo-${seed.toString(36)}`,
          redactedUrl: url,
          online: seed % 3 !== 0,
          lastOnlineAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
          renewable: true,
          deviceLimit: seed % 2 ? 2 : 1,
          devicesOnline: seed % 3 !== 0 ? 1 : 0,
          snapshot: {
            subscriptionId: `demo-${seed.toString(36)}`,
            displayName: seed % 2 ? 'سرویس طلایی' : 'Family plan',
            status: days <= 3 ? 'expiring_soon' : 'active',
            uploadBytes: used * 0.18,
            downloadBytes: used * 0.82,
            totalUsedBytes: used,
            quotaBytes: quota,
            remainingBytes: quota - used,
            quotaKind: 'known',
            expiryAt: new Date(Date.now() + days * 86_400_000).toISOString(),
            expiryKind: 'known',
            enabled: true,
            dataSource: 'demo',
            syncState: 'ok',
            lastSyncAt: new Date().toISOString(),
            lastSyncError: null,
          },
        }),
      700,
    ),
  );
}

export function demoHistory(totalUsed: number): SavedAccount['history'] {
  // Walk backwards from today's total so the last day is an ordinary day too.
  const out: SavedAccount['history'] = [];
  let used = totalUsed;
  for (let i = 0; i <= 15; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.unshift({ d: localDay(d), used: Math.max(0, used) });
    used -= ((Math.sin(i * 1.7) + 1.4) / 2.4) * (totalUsed * 0.035);
  }
  return out;
}
