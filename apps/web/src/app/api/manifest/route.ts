import { NextRequest } from 'next/server';
import { THEME_CANVAS, fetchBrand, iconVersion } from '@/lib/brand-server';

/** Per-brand web app manifest so each storefront installs under its own name and icon. */
export async function GET(req: NextRequest) {
  const tenant = req.nextUrl.searchParams.get('t') || req.headers.get('host') || 'default';
  const brand = await fetchBrand(tenant);
  const q = encodeURIComponent(tenant);
  const isSlug = !tenant.includes('.') && !tenant.includes(':') && tenant !== 'default';
  const startUrl = isSlug ? `/b/${brand.slug}` : '/';
  const bg = THEME_CANVAS[brand.theme] ?? THEME_CANVAS.mist;
  const icons = brand.iconUrl
    ? [{ src: brand.iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }]
    : [192, 512].map((s) => ({ src: `/api/icon?t=${q}&s=${s}${iconVersion(brand)}`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' }));

  return Response.json(
    {
      id: startUrl,
      name: brand.appName,
      short_name: brand.shortName,
      description: brand.tagline || brand.appName,
      start_url: startUrl,
      scope: startUrl,
      display: 'standalone',
      orientation: 'portrait',
      background_color: bg,
      theme_color: bg,
      lang: brand.defaultLocale,
      dir: brand.defaultLocale === 'fa' ? 'rtl' : 'ltr',
      icons: [
        ...icons,
        { src: `/api/icon?t=${q}&s=512&m=1${iconVersion(brand)}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' } },
  );
}
