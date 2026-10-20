import { describe, expect, it } from 'vitest';
import { pushKind } from './push.service';

describe('pushKind', () => {
  it('tells sends apart by their notification tag', () => {
    expect(pushKind('broadcast')).toBe('broadcast');
    expect(pushKind('test')).toBe('test');
    expect(pushKind('reminder-abc123')).toBe('reminder');
    expect(pushKind('renewal-r1')).toBe('renewal');
    expect(pushKind(undefined)).toBe('other');
    expect(pushKind('something')).toBe('other');
  });
});
