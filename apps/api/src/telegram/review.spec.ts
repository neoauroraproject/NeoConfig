import { describe, expect, it } from 'vitest';
import { parseCallback, receiptCaption, reviewKeyboard } from './review';

const GB = 1024 ** 3;
const base = {
  id: 'cmrenewal0001',
  displayName: 'Ali',
  subId: 'ali',
  planTitle: 'یک‌ماهه',
  price: '۱۵۰٬۰۰۰ تومان',
  days: 30,
  gb: 20,
  users: 1,
  mode: 'add',
  payerName: null,
  payerNote: null,
};

describe('receipt review', () => {
  it('shows the account now and after approval', () => {
    const text = receiptCaption('Neo', {
      ...base,
      review: {
        current: {
          status: 'active',
          quotaKind: 'known',
          quotaBytes: 50 * GB,
          totalUsedBytes: 40 * GB,
          remainingBytes: 10 * GB,
          expiryKind: 'known',
          expiryAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        },
        canApply: true,
        approvedBefore: 0,
      },
    });
    expect(text).toContain('الان: 10 گیگ مانده');
    expect(text).toContain('بعد از تأیید: 30 گیگ مانده');
    expect(text).toContain('تصویر رسید تکراری نیست');
    expect(text).toContain('اولین تمدید');
    expect(text).toContain('تک‌کاربره');
  });

  it('flags a duplicate receipt and a missing panel account', () => {
    const text = receiptCaption('Neo', {
      ...base,
      review: { duplicateOf: { id: 'x', createdAt: new Date(), status: 'APPROVED', displayName: 'Reza' }, canApply: false, pendingCount: 2 },
    });
    expect(text).toContain('رسید تکراری');
    expect(text).toContain('Reza');
    expect(text).toContain('پیدا نشد');
    expect(text).toContain('2 درخواست باز');
  });

  it('stays inside the photo caption limit', () => {
    expect(receiptCaption('Neo', { ...base, payerNote: 'x'.repeat(2000) }).length).toBeLessThanOrEqual(1024);
  });

  it('parses every button', () => {
    expect(parseCallback('nc:a:cmrenewal0001')).toEqual({ kind: 'approve', id: 'cmrenewal0001' });
    expect(parseCallback('nc:m:cmrenewal0001')).toEqual({ kind: 'manual', id: 'cmrenewal0001' });
    expect(parseCallback('nc:x3:cmrenewal0001')).toMatchObject({ kind: 'reject', note: expect.stringContaining('قبلاً') });
    expect(parseCallback('nc:z:cmrenewal0001')).toBeNull();
    const kb = reviewKeyboard('cmrenewal0001').inline_keyboard.flat().map((b) => b.callback_data);
    expect(kb.every((d) => d.length <= 64 && parseCallback(d))).toBe(true);
  });
});
