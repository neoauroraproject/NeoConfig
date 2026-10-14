import { describe, expect, it } from 'vitest';
import { usagePercent } from './format';

describe('usagePercent', () => {
  it('returns null for unknown quota', () => {
    expect(usagePercent(0, null, 'unknown')).toBeNull();
    expect(usagePercent(100, 0, 'known')).toBeNull();
  });

  it('computes percent for known quota', () => {
    expect(usagePercent(25, 100, 'known')).toBe(25);
  });
});
