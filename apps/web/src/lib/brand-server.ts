import type { Metadata, Viewport } from 'next';
import type { Branding } from './api';

const INTERNAL = process.env.API_INTERNAL_URL || 'http://localhost:4000';

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
    const res = await fetch(`${INTERNAL}/api/v1/public/branding?tenant=${encodeURIComponent(tenant)}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return FALLBACK_BRAND;
    return (await res.json()) as Branding;
  } catch {
    return FALLBACK_BRAND;
  }
}

export const THEME_CANVAS: Record<Branding['theme'], string> = {
  mist: '#e8e9f0',
  graphite: '#1a1b1f',
  sage: '#8e978f',
};

export function brandMetadata(brand: Branding, tenant: string): Metadata {
  const q = encodeURIComponent(tenant);
  return {
    title: brand.appName,
    description: brand.tagline || `${brand.appName} — subscription status`,
    manifest: `/api/manifest?t=${q}`,
    icons: {
      icon: brand.iconUrl || `/api/icon?t=${q}&s=192`,
      apple: brand.iconUrl || `/api/icon?t=${q}&s=180`,
    },
    appleWebApp: { capable: true, title: brand.shortName, statusBarStyle: 'default' },
  };
}

export function brandViewport(brand: Branding): Viewport {
  return {
    themeColor: THEME_CANVAS[brand.theme] ?? THEME_CANVAS.mist,
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  };
}
