import { describe, expect, it } from 'vitest';
import {
  decodeSubscriptionRef,
  expireToMs,
  normalizePasarGuardUser,
  subscriptionBase,
} from './pasarguard.client';

const b64 = (s: string) => Buffer.from(s).toString('base64url');

describe('PasarGuard subscription tokens', () => {
  it('decodes current HMAC tokens to a user id', () => {
    const token = `${b64('v3,42,1760000000')}.abcdefghijklmnop`;
    expect(decodeSubscriptionRef(`https://sub.example.com/sub/${token}`)).toEqual({ userId: 42 });
  });

  it('decodes legacy Marzban tokens to a username', () => {
    const token = `${b64('ali_vip,1700000000')}SIGNATURE1`;
    expect(decodeSubscriptionRef(`https://sub.example.com/sub/${token}/`)).toEqual({ username: 'ali_vip' });
  });

  it('decodes JWT tokens to the subject', () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64(JSON.stringify({ sub: 'reza', access: 'subscription' }))}.sig`;
    expect(decodeSubscriptionRef(`https://x.io/sub/${jwt}`)).toEqual({ username: 'reza' });
  });

  it('strips client-type suffixes from the subscription base', () => {
    expect(subscriptionBase('https://x.io/sub/TOKEN123456789/v2ray')).toBe('https://x.io/sub/TOKEN123456789');
  });
});

describe('normalizePasarGuardUser', () => {
  it('maps quota, expiry and native statuses', () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const n = normalizePasarGuardUser({
      username: 'u1',
      status: 'active',
      used_traffic: 1024,
      data_limit: 4096,
      expire: future,
    });
    expect(n.status).toBe('active');
    expect(n.remainingBytes).toBe(3072);
    expect(n.expiryKind).toBe('known');

    expect(normalizePasarGuardUser({ username: 'u2', status: 'on_hold', data_limit: 0 }).status).toBe('on_hold');
    expect(normalizePasarGuardUser({ username: 'u3', status: 'limited', data_limit: 0 }).quotaKind).toBe('unlimited');
  });

  it('treats naive datetimes as UTC and unix seconds as seconds', () => {
    expect(expireToMs('2026-01-01T00:00:00')).toBe(Date.UTC(2026, 0, 1));
    expect(expireToMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(expireToMs(0)).toBeNull();
  });
});
