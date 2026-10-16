import { describe, expect, it } from 'vitest';
import { aggregateMatches, collectClients } from './xui.client';

const GB = 1024 ** 3;

describe('3x-ui subId aggregation', () => {
  const inbounds = [
    {
      id: 1,
      protocol: 'vless',
      settings: JSON.stringify({
        clients: [
          { id: 'uuid-a', email: 'ali-1', subId: 'sub777', totalGB: 10 * GB, expiryTime: Date.now() + 20 * 86_400_000, enable: true },
          { id: 'uuid-x', email: 'other', subId: 'zzz', totalGB: 0, expiryTime: 0, enable: true },
        ],
      }),
      clientStats: [{ email: 'ali-1', up: 1 * GB, down: 2 * GB, total: 10 * GB, expiryTime: Date.now() + 20 * 86_400_000, enable: true }],
    },
    {
      id: 2,
      protocol: 'trojan',
      settings: JSON.stringify({
        clients: [{ password: 'pw', email: 'ali-2', subId: 'sub777', totalGB: 5 * GB, expiryTime: Date.now() + 5 * 86_400_000, enable: true }],
      }),
      clientStats: [{ email: 'ali-2', up: 0, down: 1 * GB, total: 5 * GB, expiryTime: Date.now() + 5 * 86_400_000, enable: true }],
    },
  ];

  it('sums traffic and quota across inbounds and keeps the earliest expiry', () => {
    const matches = collectClients(inbounds).filter((m) => m.client.subId === 'sub777');
    expect(matches).toHaveLength(2);
    const r = aggregateMatches('sub777', matches, new Set(['ali-2']));
    expect(r.snapshot.totalUsedBytes).toBe(4 * GB);
    expect(r.snapshot.quotaBytes).toBe(15 * GB);
    expect(r.snapshot.remainingBytes).toBe(11 * GB);
    expect(new Date(r.snapshot.expiryAt!).getTime()).toBe(inbounds[1].clientStats[0].expiryTime);
    expect(r.online).toBe(true);
  });

  it('reports unlimited when any client has no quota', () => {
    const matches = collectClients(inbounds).filter((m) => m.client.subId === 'zzz');
    const r = aggregateMatches('zzz', matches, null);
    expect(r.snapshot.quotaKind).toBe('unlimited');
    expect(r.snapshot.expiryKind).toBe('none');
    expect(r.online).toBeNull();
  });
});
