import type { ThemeId } from './api';

/** Home-screen icon backgrounds. `dark` decides which logo goes on top. */
export const ICON_BACKGROUNDS: Record<string, { fa: string; css: string; dark: boolean }> = {
  theme: { fa: 'زمینهٔ پوسته', css: '', dark: false },
  white: { fa: 'سفید', css: '#ffffff', dark: false },
  black: { fa: 'مشکی', css: '#0b0b0f', dark: true },
  brand: { fa: 'رنگ اصلی', css: '', dark: true },
  aurora: { fa: 'شفق', css: 'linear-gradient(135deg, #4f5bd5 0%, #8a5cf6 55%, #ff6a1a 100%)', dark: true },
  ocean: { fa: 'اقیانوس', css: 'linear-gradient(135deg, #22d3ee 0%, #2563eb 60%, #1e1b4b 100%)', dark: true },
  sunset: { fa: 'غروب', css: 'linear-gradient(135deg, #ff9a3c 0%, #ff3d77 55%, #8b5cf6 100%)', dark: true },
  lime: { fa: 'لیمویی', css: 'linear-gradient(135deg, #e7f9b8 0%, #b5e36b 50%, #4f9d4a 100%)', dark: false },
  pearl: { fa: 'مرواریدی', css: 'linear-gradient(118deg, #c3cdbb 0%, #e8e7a4 34%, #d3d5f1 68%, #e5e2ae 100%)', dark: false },
  rose: { fa: 'گلبهی', css: 'linear-gradient(135deg, #ffd1dc 0%, #fb7185 55%, #be123c 100%)', dark: true },
  night: { fa: 'شب', css: 'linear-gradient(160deg, #334155 0%, #0f172a 60%, #020617 100%)', dark: true },
  mint: { fa: 'نعنایی', css: 'linear-gradient(135deg, #d1fae5 0%, #5eead4 50%, #0f766e 100%)', dark: false },
};

/** White or near-black text, whichever reads on a hex color. */
export function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#121212' : '#ffffff';
}

/** Themes with a dark canvas: they show the light-colored logo. */
export const DARK_THEMES: ReadonlySet<ThemeId> = new Set<ThemeId>(['graphite', 'sage', 'moss', 'pearl']);

/** Page background per theme: the status bar / browser chrome color. */
export const THEME_CANVAS: Record<ThemeId, string> = {
  mist: '#e8e9f0',
  graphite: '#1a1b1f',
  sage: '#8e978f',
  moss: '#252724',
  pearl: '#0f0f10',
};

/** Swatches for theme pickers: background, card, highlight. */
export const THEME_SWATCH: Record<ThemeId, { canvas: string; card: string; hi: string; fa: string; en: string }> = {
  mist: { canvas: '#e8e9f0', card: '#fbfbfd', hi: '#4f5bd5', fa: 'مه', en: 'Mist' },
  graphite: { canvas: '#1a1b1f', card: '#000000', hi: '#f3f3f4', fa: 'گرافیت', en: 'Graphite' },
  sage: { canvas: '#8e978f', card: '#a2aaa1', hi: '#c8f03c', fa: 'مریم‌گلی', en: 'Sage' },
  moss: { canvas: 'radial-gradient(circle at 80% 10%, #8fb35a, #252724 70%)', card: 'rgba(255,255,255,0.12)', hi: '#d7f59e', fa: 'خزه', en: 'Moss' },
  pearl: { canvas: '#0f0f10', card: '#1c1c1e', hi: 'linear-gradient(118deg,#c3cdbb,#e8e7a4,#d3d5f1)', fa: 'مروارید', en: 'Pearl' },
};
