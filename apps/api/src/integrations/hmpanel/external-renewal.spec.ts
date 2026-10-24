import { describe, expect, it } from 'vitest';
import { externalRenewal } from './hmpanel.client';

const GB = 1024 ** 3;
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 24);

describe('externalRenewal (PasarGuard users through HMPanel)', () => {
  it('adds the plan on top of what is left, as absolute expiry days and GB', () => {
    const body = externalRenewal(
      { usedBytes: 10 * GB, totalBytes: 30 * GB, expiryMs: now + 5 * DAY },
      { days: 30, gb: 20, users: 2, mode: 'add' },
      now,
    );
    expect(body).toEqual({ enabled: true, expiryDays: 35, dataLimitGb: 50, hwidLimit: 2 });
  });

  it('starts from today when expired, and a reset plan means used + the plan (no usage reset there)', () => {
    const body = externalRenewal(
      { usedBytes: 12 * GB, totalBytes: 12 * GB, expiryMs: now - 3 * DAY },
      { days: 30, gb: 50, users: 0, mode: 'reset' },
      now,
    );
    expect(body).toEqual({ enabled: true, expiryDays: 30, dataLimitGb: 62 });
  });
});
