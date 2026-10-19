/** Coarse device facts from a User-Agent: enough for stats, nothing that identifies a person. */
export function parseUserAgent(ua: string | undefined | null): { platform: string; browser: string } {
  const s = ua || '';
  const platform = /iPhone|iPod/i.test(s)
    ? 'iPhone'
    : /iPad/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))
      ? 'iPad'
      : /Android/i.test(s)
        ? 'Android'
        : /Windows/i.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/i.test(s)
            ? 'macOS'
            : /Linux|X11/i.test(s)
              ? 'Linux'
              : 'Other';
  const browser = /Telegram/i.test(s)
    ? 'Telegram'
    : /Instagram/i.test(s)
      ? 'Instagram'
      : /FBAN|FBAV/i.test(s)
        ? 'Facebook'
        : /EdgA?\/|EdgiOS/i.test(s)
          ? 'Edge'
          : /OPR\/|OPiOS|Opera/i.test(s)
            ? 'Opera'
            : /SamsungBrowser/i.test(s)
              ? 'Samsung'
              : /YaBrowser/i.test(s)
                ? 'Yandex'
                : /FxiOS|Firefox/i.test(s)
                  ? 'Firefox'
                  : /CriOS|Chrome|Chromium/i.test(s)
                    ? 'Chrome'
                    : /Safari/i.test(s)
                      ? 'Safari'
                      : 'Other';
  return { platform, browser };
}
