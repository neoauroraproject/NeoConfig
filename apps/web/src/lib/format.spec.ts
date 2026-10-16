import { describe, expect, it } from 'vitest';
import { bytesParts, formatBytes, groupCard, usageFraction } from './format';

describe('format', () => {
  it('splits bytes for the hero display', () => {
    expect(bytesParts(25.5 * 1024 ** 3)).toEqual({ int: '25', dec: '.50', unit: 'GB' });
    expect(bytesParts(null)).toBeNull();
  });

  it('drops trailing zeros in compact labels', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
  });

  it('returns null fraction when quota is not known', () => {
    expect(usageFraction(10, null)).toBeNull();
    expect(usageFraction(25, 100)).toBe(0.25);
  });

  it('groups card numbers in fours', () => {
    expect(groupCard('6037991234567890')).toBe('6037 9912 3456 7890');
  });
});
