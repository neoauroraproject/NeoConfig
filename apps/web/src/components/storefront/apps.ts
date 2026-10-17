/**
 * Client apps that can import a subscription link, per platform.
 * `link` builds the app's import deep link; apps without one get "copy then import".
 */
export type Platform = 'android' | 'ios' | 'windows' | 'macos' | 'linux';

export interface ClientApp {
  id: string;
  name: string;
  link?: (url: string, name: string) => string;
  get: string;
}

const enc = encodeURIComponent;
const b64 = (s: string) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : s);

const hiddify = (get: string): ClientApp => ({
  id: 'hiddify',
  name: 'Hiddify',
  link: (u, n) => `hiddify://import/${u}#${enc(n)}`,
  get,
});

export const APPS: Record<Platform, ClientApp[]> = {
  android: [
    { id: 'v2box', name: 'V2Box', link: (u, n) => `v2box://install-sub?url=${enc(u)}&name=${enc(n)}`, get: 'https://play.google.com/store/apps/details?id=dev.hexasoftware.v2box' },
    { id: 'v2rayng', name: 'v2rayNG', link: (u, n) => `v2rayng://install-sub?url=${enc(u)}&name=${enc(n)}`, get: 'https://github.com/2dust/v2rayNG/releases/latest' },
    hiddify('https://github.com/hiddify/hiddify-app/releases/latest'),
    { id: 'happ', name: 'Happ', link: (u) => `happ://add/${u}`, get: 'https://www.happ.su/' },
    { id: 'nekobox', name: 'NekoBox', link: (u, n) => `sn://subscription?url=${enc(u)}&name=${enc(n)}`, get: 'https://github.com/MatsuriDayo/NekoBoxForAndroid/releases/latest' },
  ],
  ios: [
    { id: 'v2box', name: 'V2Box', link: (u, n) => `v2box://install-sub?url=${enc(u)}&name=${enc(n)}`, get: 'https://apps.apple.com/app/id6446814690' },
    { id: 'streisand', name: 'Streisand', link: (u, n) => `streisand://import/${u}#${enc(n)}`, get: 'https://apps.apple.com/app/id6450534064' },
    hiddify('https://hiddify.com/'),
    { id: 'happ', name: 'Happ', link: (u) => `happ://add/${u}`, get: 'https://www.happ.su/' },
    { id: 'shadowrocket', name: 'Shadowrocket', link: (u) => `sub://${b64(u)}`, get: 'https://apps.apple.com/app/id932747118' },
  ],
  windows: [
    hiddify('https://github.com/hiddify/hiddify-app/releases/latest'),
    { id: 'v2rayn', name: 'v2rayN', get: 'https://github.com/2dust/v2rayN/releases/latest' },
    { id: 'happ', name: 'Happ', link: (u) => `happ://add/${u}`, get: 'https://www.happ.su/' },
  ],
  macos: [
    { id: 'v2box', name: 'V2Box', link: (u, n) => `v2box://install-sub?url=${enc(u)}&name=${enc(n)}`, get: 'https://apps.apple.com/app/id6446814690' },
    hiddify('https://github.com/hiddify/hiddify-app/releases/latest'),
    { id: 'streisand', name: 'Streisand', link: (u, n) => `streisand://import/${u}#${enc(n)}`, get: 'https://apps.apple.com/app/id6450534064' },
  ],
  linux: [
    hiddify('https://github.com/hiddify/hiddify-app/releases/latest'),
    { id: 'v2rayn', name: 'v2rayN', get: 'https://github.com/2dust/v2rayN/releases/latest' },
  ],
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  android: 'Android',
  ios: 'iPhone / iPad',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export function detectPlatform(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): Platform {
  const u = ua.toLowerCase();
  if (/android/.test(u)) return 'android';
  if (/iphone|ipad|ipod/.test(u) || (/macintosh/.test(u) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/windows/.test(u)) return 'windows';
  if (/mac os|macintosh/.test(u)) return 'macos';
  return 'linux';
}
