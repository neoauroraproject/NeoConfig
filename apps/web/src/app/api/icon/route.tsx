import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { INTERNAL, THEME_CANVAS, fetchBrand } from '@/lib/brand-server';

/** The uploaded logo as a data URL (satori needs the bytes, and the API is internal). */
async function loadLogo(url: string): Promise<string | null> {
  try {
    const res = await fetch(url.startsWith('http') ? url : `${INTERNAL}${url}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/png';
    if (!/^image\/(png|jpeg)/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

/** App icon / favicon: the brand logo on the theme canvas, or nested rings in the brand color. */
export async function GET(req: NextRequest) {
  const tenant = req.nextUrl.searchParams.get('t') || 'default';
  const size = Math.min(1024, Math.max(48, Number(req.nextUrl.searchParams.get('s')) || 512));
  const maskable = req.nextUrl.searchParams.get('m') === '1';
  const brand = await fetchBrand(tenant);
  const bg = THEME_CANVAS[brand.theme] ?? THEME_CANVAS.mist;
  const c = brand.primaryColor;
  const k = maskable ? 0.62 : 0.78;
  const headers = { 'Cache-Control': 'public, max-age=3600' };

  const logo = brand.logoUrl ? await loadLogo(brand.logoUrl) : null;
  if (logo) {
    // Small favicons get almost the whole square; maskable icons keep the safe zone.
    const fill = maskable ? 0.6 : size <= 64 ? 0.94 : 0.8;
    return new ImageResponse(
      (
        <div style={{ width: size, height: size, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo} width={size * fill} height={size * fill} style={{ objectFit: 'contain' }} />
        </div>
      ),
      { width: size, height: size, headers },
    );
  }
  const ring = (d: number, dy: number, fill = false) => (
    <div
      style={{
        position: 'absolute',
        width: size * k * d,
        height: size * k * d,
        left: (size - size * k * d) / 2,
        top: (size - size * k * d) / 2 + size * k * dy,
        borderRadius: '50%',
        border: fill ? 'none' : `${Math.max(2, size * 0.028)}px solid ${c}`,
        background: fill ? c : 'transparent',
      }}
    />
  );
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, background: bg, display: 'flex', position: 'relative' }}>
        {ring(1, 0)}
        {ring(0.66, 0.08)}
        {ring(0.36, 0.17, true)}
      </div>
    ),
    { width: size, height: size, headers },
  );
}
