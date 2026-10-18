import type { ThemeId } from './api';

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
