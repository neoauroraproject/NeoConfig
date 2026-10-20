import { describe, expect, it } from 'vitest';
import { looksLikeConfig, parseConfigLink } from './config-link';
import { subscriptionUriFromSettings } from '../integrations/xui/xui.client';
import { userCredentials } from '../integrations/pasarguard/pasarguard.client';

const UUID = '3f6c2b1e-8a4d-4c2e-9b7a-1d2e3f4a5b6c';

describe('parseConfigLink', () => {
  it('reads the uuid from vless and the host it points at', () => {
    expect(parseConfigLink(`vless://${UUID}@de1.example.com:443?type=ws&security=tls#Ali%20VIP`)).toEqual({
      protocol: 'vless',
      key: UUID,
      host: 'de1.example.com',
    });
  });

  it('reads vmess base64 JSON', () => {
    const body = Buffer.from(JSON.stringify({ v: '2', ps: 'x', add: '1.2.3.4', port: 80, id: UUID })).toString('base64');
    expect(parseConfigLink(`vmess://${body}`)).toEqual({ protocol: 'vmess', key: UUID, host: '1.2.3.4' });
  });

  it('reads trojan and hysteria2 passwords', () => {
    expect(parseConfigLink('trojan://s3cretPass@t.example.com:443#t')?.key).toBe('s3cretPass');
    expect(parseConfigLink('hy2://authKey123@[2001:db8::1]:443?sni=x#h')).toEqual({
      protocol: 'hy2',
      key: 'authKey123',
      host: '2001:db8::1',
    });
  });

  it('reads the client password from shadowsocks links (plain, SIP002, multi-user 2022)', () => {
    const sip = Buffer.from('chacha20-ietf-poly1305:clientPw1').toString('base64url');
    expect(parseConfigLink(`ss://${sip}@s.example.com:8388#n`)?.key).toBe('clientPw1');
    const legacy = Buffer.from('aes-256-gcm:clientPw2@s.example.com:8388').toString('base64');
    expect(parseConfigLink(`ss://${legacy}#n`)).toEqual({ protocol: 'ss', key: 'clientPw2', host: 's.example.com' });
    const multi = Buffer.from('2022-blake3-aes-128-gcm:serverKey==:userKey==').toString('base64');
    expect(parseConfigLink(`ss://${multi}@s.example.com:443`)?.key).toBe('userKey==');
  });

  it('takes the first config of a multi-line paste and ignores everything else', () => {
    expect(parseConfigLink(`Your configs:\n\nvless://${UUID}@a.example.com:443#1\ntrojan://other@b:1#2`)?.key).toBe(UUID);
    expect(parseConfigLink('https://sub.example.com/sub/abc')).toBeNull();
    expect(parseConfigLink('vless://@host:443')).toBeNull();
    expect(looksLikeConfig('hello')).toBe(false);
  });
});

describe('subscriptionUriFromSettings', () => {
  it('prefers the configured subURI', () => {
    expect(subscriptionUriFromSettings({ subURI: 'https://s.example.com/feed' }, 'panel.example.com')).toBe(
      'https://s.example.com/feed/',
    );
  });

  it('builds it the way 3x-ui does when left empty', () => {
    expect(
      subscriptionUriFromSettings(
        { subEnable: true, subURI: '', subPort: 2096, subPath: '/sub/', subDomain: '', subCertFile: '/c', subKeyFile: '/k' },
        'panel.example.com',
      ),
    ).toBe('https://panel.example.com:2096/sub/');
    expect(subscriptionUriFromSettings({ subEnable: true, subPort: 80, subPath: 'feed', subDomain: 'sub.example.com' }, 'p')).toBe(
      'http://sub.example.com/feed/',
    );
  });

  it('gives nothing when the subscription service is off', () => {
    expect(subscriptionUriFromSettings({ subEnable: false, subPort: 2096 }, 'p')).toBeNull();
  });
});

describe('PasarGuard userCredentials', () => {
  it('collects ids and passwords from PasarGuard and Marzban shapes', () => {
    expect(
      userCredentials({
        username: 'ali',
        proxy_settings: { vless: { id: UUID }, trojan: { password: 'tp' }, shadowsocks: { password: 'sp' } },
        proxies: { vmess: { id: 'vm-id' } },
      }),
    ).toEqual([UUID, 'tp', 'sp', 'vm-id']);
  });
});
