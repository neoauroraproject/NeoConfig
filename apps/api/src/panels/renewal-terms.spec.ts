import { describe, expect, it } from 'vitest';
import { nextExpiryMs, nextQuotaBytes, normalizeTerms } from './renewal-terms';

const GB = 1024 ** 3;
const DAY = 86_400_000;

describe('renewal terms', () => {
  it('adds days to a running subscription and to now for an expired one', () => {
    const now = 1_000 * DAY;
    expect(nextExpiryMs(now + 5 * DAY, 30, now)).toBe(now + 35 * DAY);
    expect(nextExpiryMs(now - 3 * DAY, 30, now)).toBe(now + 30 * DAY);
    expect(nextExpiryMs(0, 30, now)).toBe(now + 30 * DAY);
    expect(nextExpiryMs(now + 5 * DAY, 0, now)).toBe(now + 5 * DAY);
  });

  it('add mode stacks data on the current quota and keeps unlimited unlimited', () => {
    const t = normalizeTerms({ days: 30, gb: 20, mode: 'add' });
    expect(nextQuotaBytes(50 * GB, t)).toBe(70 * GB);
    expect(nextQuotaBytes(0, t)).toBe(0);
  });

  it('reset mode sets the new total, 0 meaning unlimited', () => {
    expect(nextQuotaBytes(50 * GB, normalizeTerms({ gb: 30, mode: 'reset' }))).toBe(30 * GB);
    expect(nextQuotaBytes(50 * GB, normalizeTerms({ gb: 0, mode: 'reset' }))).toBe(0);
  });

  it('defaults to add and clamps bad input', () => {
    expect(normalizeTerms({ days: -4, gb: Number.NaN, users: 2.6 })).toEqual({ days: 0, gb: 0, users: 3, mode: 'add' });
  });
});
