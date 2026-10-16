import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { THEME_CANVAS, fetchBrand } from '@/lib/brand-server';

/** App icon drawn from the brand colors: nested rings on the theme canvas. */
export async function GET(req: NextRequest) {
  const tenant = req.nextUrl.searchParams.get('t') || 'default';
  const size = Math.min(1024, Math.max(48, Number(req.nextUrl.searchParams.get('s')) || 512));
  const maskable = req.nextUrl.searchParams.get('m') === '1';
  const brand = await fetchBrand(tenant);
  const bg = THEME_CANVAS[brand.theme] ?? THEME_CANVAS.mist;
  const c = brand.primaryColor;
  const k = maskable ? 0.62 : 0.78;
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
    { width: size, height: size, headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
