import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './user-agent';

describe('parseUserAgent', () => {
  it('names the usual phones and browsers', () => {
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toEqual({ platform: 'iPhone', browser: 'Safari' });
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) CriOS/126.0 Mobile/15E148 Safari/604.1')).toEqual({ platform: 'iPhone', browser: 'Chrome' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toEqual({ platform: 'Android', browser: 'Chrome' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36')).toEqual({ platform: 'Android', browser: 'Samsung' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36 Edg/126.0')).toEqual({ platform: 'Windows', browser: 'Edge' });
    expect(parseUserAgent(undefined)).toEqual({ platform: 'Other', browser: 'Other' });
  });
});
