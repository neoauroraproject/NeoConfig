import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fingerprint, redactUrl } from './secret.crypto';

describe('secret crypto', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('round-trips secrets', () => {
    const plain = 'https://panel.example.com/sub/secret-token';
    const enc = encryptSecret(plain, key);
    expect(enc).not.toContain('secret-token');
    expect(decryptSecret(enc, key)).toBe(plain);
  });

  it('redacts urls', () => {
    expect(redactUrl('https://a.com/sub/abcdef')).toContain('***');
  });

  it('fingerprints stably', () => {
    expect(fingerprint('abc')).toBe(fingerprint('abc'));
  });
});
