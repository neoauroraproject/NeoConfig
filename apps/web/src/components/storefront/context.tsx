'use client';

import { createContext, useContext } from 'react';
import type { Branding } from '@/lib/api';
import { DictKey, Locale, t as translate } from '@/lib/i18n';
import { inkOn } from '@/lib/themes';

export type SfContextValue = {
  brand: Branding;
  tenant: string;
  locale: Locale;
  t: (key: DictKey) => string;
  toast: (message: string) => void;
  /** Preview mode (admin editor): no network, no storage. */
  preview?: boolean;
};

export const SfContext = createContext<SfContextValue | null>(null);

export function useSf() {
  const ctx = useContext(SfContext);
  if (!ctx) throw new Error('useSf outside storefront');
  return ctx;
}

export function makeT(locale: Locale) {
  return (key: DictKey) => translate(locale, key);
}

/** CSS variables a storefront wrapper needs for a brand. */
export function brandStyle(brand: Pick<Branding, 'primaryColor' | 'accentColor'> & Partial<Pick<Branding, 'buttonColor'>>): React.CSSProperties {
  const btn = brand.buttonColor || brand.primaryColor;
  return {
    ['--brand' as string]: brand.primaryColor,
    ['--accent' as string]: brand.accentColor,
    ['--btn' as string]: btn,
    ['--btn-ink' as string]: inkOn(btn),
  };
}
