import { describe, expect, it } from 'vitest';
import {
  deriveStatus,
  normalizeFromClient,
  normalizeFromClientTraffic,
  normalizeFromUserInfoHeaders,
  parseSubscriptionUserInfo,
  unknownSnapshot,
} from './normalize';
import { XuiClientTraffic } from './types';

const sampleTraffic: XuiClientTraffic = {
  id: 1,
  inboundId: 1,
  enable: true,
  email: 'user1',
  up: 1_048_576,
  down: 2_097_152,
  total: 10_737_418_240,
  expiryTime: Date.now() + 12 * 24 * 60 * 60 * 1000,
  lastOnline: 0,
  lastSubFetch: 0,
  reset: 0,
  resetDay: 0,
  resetWeekday: 0,
  resetMax: 0,
  resetCount: 0,
  subId: 'i7tvdpeffi0hvvf1',
  uuid: 'e18c9a96-71bf-48d4-933f-8b9a46d4290c',
};

describe('parseSubscriptionUserInfo', () => {
  it('parses documented-style header', () => {
    const parsed = parseSubscriptionUserInfo(
      'upload=1048576; download=2097152; total=10737418240; expire=1893456000',
    );
    expect(parsed).toEqual({
      upload: 1048576,
      download: 2097152,
      total: 10737418240,
      expire: 1893456000,
    });
  });

  it('returns null for empty', () => {
    expect(parseSubscriptionUserInfo('')).toBeNull();
    expect(parseSubscriptionUserInfo(null)).toBeNull();
  });
});

describe('normalizeFromClientTraffic', () => {
  it('maps ClientTraffic fields from docs/api310.json', () => {
    const n = normalizeFromClientTraffic(sampleTraffic);
    expect(n.uploadBytes).toBe(1_048_576);
    expect(n.downloadBytes).toBe(2_097_152);
    expect(n.totalUsedBytes).toBe(1_048_576 + 2_097_152);
    expect(n.quotaKind).toBe('known');
    expect(n.quotaBytes).toBe(10_737_418_240);
    expect(n.remainingBytes).toBe(10_737_418_240 - (1_048_576 + 2_097_152));
    expect(n.status).toBe('active');
    expect(n.dataSource).toBe('3x-ui:clients/traffic');
  });

  it('treats total=0 as unlimited', () => {
    const n = normalizeFromClientTraffic({ ...sampleTraffic, total: 0 });
    expect(n.quotaKind).toBe('unlimited');
    expect(n.quotaBytes).toBeNull();
    expect(n.remainingBytes).toBeNull();
  });

  it('treats expiryTime=0 as no expiration', () => {
    const n = normalizeFromClientTraffic({ ...sampleTraffic, expiryTime: 0 });
    expect(n.expiryKind).toBe('none');
    expect(n.expiryAt).toBeNull();
  });

  it('marks disabled clients', () => {
    const n = normalizeFromClientTraffic({ ...sampleTraffic, enable: false });
    expect(n.status).toBe('disabled');
  });
});

describe('normalizeFromClient', () => {
  it('converts totalGB to bytes', () => {
    const n = normalizeFromClient({
      email: 'a@b.c',
      enable: true,
      expiryTime: 0,
      totalGB: 100,
      subId: 'abc',
    });
    expect(n.quotaKind).toBe('known');
    expect(n.quotaBytes).toBe(100 * 1024 * 1024 * 1024);
    expect(n.uploadBytes).toBeNull();
  });
});

describe('normalizeFromUserInfoHeaders', () => {
  it('does not invent zeros for missing usage', () => {
    const n = normalizeFromUserInfoHeaders({ total: 0, expire: 0 });
    expect(n.uploadBytes).toBeNull();
    expect(n.downloadBytes).toBeNull();
    expect(n.totalUsedBytes).toBeNull();
    expect(n.quotaKind).toBe('unlimited');
  });
});

describe('deriveStatus / unknownSnapshot', () => {
  it('never treats unknown as 100% used', () => {
    const u = unknownSnapshot('x', 'X');
    expect(u.quotaKind).toBe('unknown');
    expect(u.remainingBytes).toBeNull();
    expect(u.status).toBe('unknown');
  });

  it('detects expiring soon', () => {
    const status = deriveStatus({
      enabled: true,
      expiryAtMs: Date.now() + 24 * 60 * 60 * 1000,
      expiryKind: 'known',
      remainingBytes: 100,
      quotaKind: 'known',
    });
    expect(status).toBe('expiring_soon');
  });
});
