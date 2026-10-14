import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, SsrfError } from './ssrf.guard';

describe('SSRF URL validation', () => {
  it('allows public https URLs', () => {
    const u = assertPublicHttpUrl('https://sub.example.com/sub/abc123');
    expect(u.hostname).toBe('sub.example.com');
  });

  it('blocks localhost', () => {
    expect(() => assertPublicHttpUrl('http://localhost/admin')).toThrow(SsrfError);
  });

  it('blocks private IPs', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/x')).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl('http://10.0.0.5/x')).toThrow(SsrfError);
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toThrow(
      SsrfError,
    );
  });

  it('blocks credentialed URLs', () => {
    expect(() => assertPublicHttpUrl('https://user:pass@example.com/x')).toThrow(SsrfError);
  });
});
