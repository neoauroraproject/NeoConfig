import { describe, expect, it } from 'vitest';
import { configNameFrom, storeCannotRenew } from './renewals.service';

describe('HMPanel store rules', () => {
  it('falls back to NeoConfig review only when the store refuses the service itself', () => {
    expect(storeCannotRenew(new Error('Service not found for renewal'))).toBe(true);
    expect(storeCannotRenew(new Error('This service can only be renewed with a Pasarguard product'))).toBe(true);
    expect(storeCannotRenew(new Error('Store is disabled'))).toBe(false);
    expect(storeCannotRenew(new Error('Missing scope: store.write'))).toBe(false);
  });

  it('gives HMPanel a Latin config name', () => {
    expect(configNameFrom('Reza Ahmadi')).toBe('rezaahmadi');
    expect(configNameFrom('رضا')).toBe('user');
    expect(configNameFrom(null)).toBe('user');
  });
});
