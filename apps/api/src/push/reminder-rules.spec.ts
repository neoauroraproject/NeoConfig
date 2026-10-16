import { describe, expect, it } from 'vitest';
import { checkThresholds, planReminders, reminderText } from './reminder-rules';

const GB = 1024 ** 3;
const now = new Date('2026-10-16T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000).toISOString();

const base = {
  status: 'active' as const,
  expiryAt: inDays(20),
  expiryKind: 'known' as const,
  quotaKind: 'known' as const,
  quotaBytes: 100 * GB,
  remainingBytes: 60 * GB,
  totalUsedBytes: 40 * GB,
};

describe('checkThresholds', () => {
  it('is quiet for a healthy account', () => {
    expect(checkThresholds(base, now)).toEqual({ due: [], daysLeft: 20, dataLeft: 0.6 });
  });

  it('fires the days threshold at exactly 3 days, not at 3 days and a bit', () => {
    expect(checkThresholds({ ...base, expiryAt: inDays(3) }, now).due).toEqual(['days']);
    expect(checkThresholds({ ...base, expiryAt: inDays(3.01) }, now).due).toEqual([]);
  });

  it('counts an expired account as due with zero days left', () => {
    const c = checkThresholds({ ...base, status: 'expired', expiryAt: inDays(-2) }, now);
    expect(c.due).toEqual(['days']);
    expect(c.daysLeft).toBe(0);
  });

  it('fires the data threshold at 10% left', () => {
    expect(checkThresholds({ ...base, remainingBytes: 10 * GB }, now).due).toEqual(['data']);
    expect(checkThresholds({ ...base, remainingBytes: 10.5 * GB }, now).due).toEqual([]);
  });

  it('derives remaining data from usage when the panel omits it', () => {
    const c = checkThresholds({ ...base, remainingBytes: null, totalUsedBytes: 95 * GB }, now);
    expect(c.due).toEqual(['data']);
    expect(c.dataLeft).toBeCloseTo(0.05);
  });

  it('reports both thresholds together', () => {
    expect(checkThresholds({ ...base, expiryAt: inDays(1), remainingBytes: 0 }, now).due).toEqual(['days', 'data']);
  });

  it('ignores unlimited, unknown and missing limits', () => {
    const c = checkThresholds(
      { ...base, expiryKind: 'none', expiryAt: null, quotaKind: 'unlimited', quotaBytes: null, remainingBytes: null },
      now,
    );
    expect(c).toEqual({ due: [], daysLeft: null, dataLeft: null });
    expect(checkThresholds({ ...base, expiryKind: 'unknown', expiryAt: inDays(1) }, now).due).toEqual([]);
    expect(checkThresholds({ ...base, quotaBytes: 0, remainingBytes: 0 }, now).due).toEqual([]);
  });

  it('skips disabled and not-yet-started accounts', () => {
    const low = { ...base, expiryAt: inDays(1), remainingBytes: 0 };
    expect(checkThresholds({ ...low, status: 'disabled' }, now).due).toEqual([]);
    expect(checkThresholds({ ...low, status: 'on_hold' }, now).due).toEqual([]);
  });
});

describe('planReminders', () => {
  it('sends a newly crossed threshold', () => {
    expect(planReminders(['days'], [])).toEqual({ send: ['days'], rearm: [] });
  });

  it('does not send the same threshold twice', () => {
    expect(planReminders(['days', 'data'], ['days', 'data'])).toEqual({ send: [], rearm: [] });
  });

  it('sends only the threshold that is new', () => {
    expect(planReminders(['days', 'data'], ['days'])).toEqual({ send: ['data'], rearm: [] });
  });

  it('re-arms thresholds the account climbed back above after a renewal', () => {
    expect(planReminders([], ['days', 'data'])).toEqual({ send: [], rearm: ['days', 'data'] });
    expect(planReminders(['data'], ['days', 'data'])).toEqual({ send: [], rearm: ['days'] });
  });

  it('sends again in the next cycle once re-armed', () => {
    const { rearm } = planReminders([], ['days']);
    const stillSent = (['days'] as const).filter((k) => !rearm.includes(k));
    expect(planReminders(['days'], [...stillSent])).toEqual({ send: ['days'], rearm: [] });
  });
});

describe('reminderText', () => {
  it('writes Persian copy by default', () => {
    const t = reminderText(['days'], { due: ['days'], daysLeft: 2, dataLeft: 0.5 }, 'fa', 'نئو');
    expect(t.title).toBe('اشتراک شما رو به پایان است');
    expect(t.body).toContain('۲ روز دیگر');
  });

  it('combines both thresholds in one message', () => {
    const t = reminderText(['days', 'data'], { due: ['days', 'data'], daysLeft: 1, dataLeft: 0.08 }, 'en', 'Neo');
    expect(t.body).toBe('Your Neo subscription expires in 1 day and has 8% of its data left. Renew to stay connected.');
  });

  it('says expired when no days are left', () => {
    expect(reminderText(['days'], { due: ['days'], daysLeft: 0, dataLeft: null }, 'en', 'Neo').title).toBe(
      'Your subscription has expired',
    );
  });
});
