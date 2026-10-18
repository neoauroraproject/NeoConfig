import type { Metadata, Viewport } from 'next';
import type { Branding } from './api';
import { THEME_CANVAS } from './themes';

export const INTERNAL = process.env.API_INTERNAL_URL || 'http://localhost:4000';

export const FALLBACK_BRAND: Branding = {
  slug: 'default',
  appName: 'NeoConfig',
  shortName: 'NeoConfig',
  tagline: null,
  logoUrl: null,
  iconUrl: null,
  primaryColor: '#4F5BD5',
  accentColor: '#FF6A1A',
  theme: 'mist',
  defaultLocale: 'fa',
  supportUrl: null,
  supportTelegram: null,
  contactEmail: null,
  allowCopyLink: true,
  renewal: null,
};

export async function fetchBrand(tenant: string): Promise<Branding> {
  try {
    // Always fresh: admins expect a saved change to show on the next page load.
    const res = await fetch(`${INTERNAL}/api/v1/public/branding?tenant=${encodeURIComponent(tenant)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return FALLBACK_BRAND;
    return (await res.json()) as Branding;
  } catch {
    return FALLBACK_BRAND;
  }
}

export { THEME_CANVAS };

export function brandMetadata(brand: Branding, tenant: string): Metadata {
  const q = encodeURIComponent(tenant);
  return {
    title: brand.appName,
    description: brand.tagline || `${brand.appName} — subscription status`,
    manifest: `/api/manifest?t=${q}`,
    // The uploaded logo becomes the favicon and home-screen icon (drawn by /api/icon).
    icons: {
      icon: brand.iconUrl
        ? brand.iconUrl
        : [
            { url: `/api/icon?t=${q}&s=32${iconVersion(brand)}`, sizes: '32x32', type: 'image/png' },
            { url: `/api/icon?t=${q}&s=192${iconVersion(brand)}`, sizes: '192x192', type: 'image/png' },
          ],
      apple: brand.iconUrl || `/api/icon?t=${q}&s=180${iconVersion(brand)}`,
    },
    appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: 'default' },
  };
}

/** Changes whenever the logo or colors change, so browsers drop a cached favicon. */
export function iconVersion(brand: Branding) {
  const logo = brand.logoUrl ? /[?&]v=([^&]+)/.exec(brand.logoUrl)?.[1] ?? brand.logoUrl.length : 'r';
  return `&v=${encodeURIComponent(`${logo}-${brand.primaryColor.slice(1)}-${brand.theme}`)}`;
}

export function brandViewport(brand: Branding): Viewport {
  return {
    themeColor: THEME_CANVAS[brand.theme] ?? THEME_CANVAS.mist,
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    // Android: the keyboard shrinks the layout like on iOS, so bottom-pinned UI stays visible.
    interactiveWidget: 'resizes-content',
  };
}
