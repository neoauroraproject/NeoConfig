'use client';

const TOKEN_KEY = 'neoconfig.token';
const LOCALE_KEY = 'neoconfig.locale';
const THEME_KEY = 'neoconfig.theme';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getLocale(): 'en' | 'fa' | 'ar' {
  if (typeof window === 'undefined') return 'en';
  const v = localStorage.getItem(LOCALE_KEY);
  if (v === 'fa' || v === 'ar' || v === 'en') return v;
  return 'en';
}

export function setLocale(locale: 'en' | 'fa' | 'ar') {
  localStorage.setItem(LOCALE_KEY, locale);
}

export function getTheme(): 'dark' | 'light' | 'system' {
  if (typeof window === 'undefined') return 'system';
  const v = localStorage.getItem(THEME_KEY);
  if (v === 'dark' || v === 'light' || v === 'system') return v;
  return 'system';
}

export function setTheme(theme: 'dark' | 'light' | 'system') {
  localStorage.setItem(THEME_KEY, theme);
}
