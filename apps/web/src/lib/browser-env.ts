'use client';

export type Platform = 'ios-safari' | 'ios-other' | 'android' | 'android-inapp' | 'other';

const IN_APP = /FBAN|FBAV|Instagram|Line\/|Twitter|Telegram|WhatsApp|Snapchat|; wv\)/i;

/** Which in-app browser this is, when we can tell (for the banner's wording). */
export function inAppName(): string | null {
  if (typeof window === 'undefined') return null;
  const ua = navigator.userAgent;
  // Telegram's own browser adds this bridge on iPhone and Android, even when its UA looks like Safari/Chrome.
  if ('TelegramWebviewProxy' in window || 'TelegramWebview' in window || /Telegram/i.test(ua)) return 'Telegram';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Line\//i.test(ua)) return 'LINE';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/Twitter/i.test(ua)) return 'X';
  if (/; wv\)/i.test(ua)) return 'app';
  return null;
}

/**
 * The browser situation that matters for installing and notifications:
 * only Safari on iPhone, and a real browser (not an app's web view) on Android.
 */
export function platform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  const inApp = inAppName() !== null || IN_APP.test(ua);
  if (/iphone|ipad|ipod/i.test(ua)) return /crios|fxios|edgios|opios/i.test(ua) || inApp ? 'ios-other' : 'ios-safari';
  if (/android/i.test(ua)) return inApp ? 'android-inapp' : 'android';
  return 'other';
}

/** A link that reopens this exact page in the system browser that can install it. */
export function systemBrowserUrl(pf: Platform, href: string): string | null {
  if (pf === 'ios-other') return `x-safari-${href}`;
  if (pf === 'android-inapp') {
    const u = new URL(href);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  }
  return null;
}
