import { describe, expect, it } from 'vitest';
import { checkThresholds } from './reminder-rules';
import { compactReminderSettings, parseReminderSettings, reminderMessage } from './reminder-settings';

const GB = 1024 ** 3;
const now = new Date('2026-10-19T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const base = {
  status: 'active' as const,
  expiryAt: inDays(5),
  expiryKind: 'known' as const,
  quotaKind: 'known' as const,
  quotaBytes: 100 * GB,
  remainingBytes: 18 * GB,
  totalUsedBytes: 82 * GB,
};

describe('brand reminder settings', () => {
  it('uses the brand thresholds', () => {
    const s = parseReminderSettings(JSON.stringify({ days: 7, dataPercent: 20 }));
    expect(checkThresholds(base, now, s).due).toEqual(['days', 'data']);
    expect(checkThresholds(base, now, parseReminderSettings('{}')).due).toEqual([]);
    expect(checkThresholds({ ...base, expiryAt: inDays(-1) }, now, parseReminderSettings('{"expired":false,"days":0}')).due).toEqual([]);
  });

  it('fills the brand wording, most urgent first', () => {
    const s = parseReminderSettings(JSON.stringify({ texts: { days: { body: '{name}: {days} روز مانده' } } }));
    const check = checkThresholds(base, now, { ...s, days: 7 });
    expect(reminderMessage(check.due, check, s, { app: 'Neo', name: 'Aria' }).body).toBe('Aria: ۵ روز مانده');
    expect(reminderMessage(['data'], check, s, { app: 'Neo', name: 'Aria' }).body).toContain('۱۸٪');
  });

  it('stores only what differs from the defaults', () => {
    expect(compactReminderSettings({ days: 3, dataPercent: 15, texts: { days: { title: 'اشتراک شما رو به پایان است' } } })).toBe('{"dataPercent":15}');
  });
});
