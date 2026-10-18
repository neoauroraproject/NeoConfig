/* eslint-disable @next/next/no-img-element */
import type { Branding } from '@/lib/api';
import { DARK_THEMES } from '@/lib/themes';

/** Brand logo, or a nested-ring monogram drawn in the brand color. */
export function BrandMark({
  brand,
  size = 40,
  className = '',
  onDark,
}: {
  brand: Pick<Branding, 'logoUrl' | 'appName' | 'shortName'> & Partial<Pick<Branding, 'logoDarkUrl' | 'theme'>>;
  size?: number;
  className?: string;
  /** Force the logo for a dark (true) or light (false) background; default follows the theme. */
  onDark?: boolean;
}) {
  const dark = onDark ?? Boolean(brand.theme && DARK_THEMES.has(brand.theme));
  const src = dark ? brand.logoDarkUrl || brand.logoUrl : brand.logoUrl || brand.logoDarkUrl;
  if (src) {
    return (
      <img
        src={src}
        alt={brand.appName}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={brand.appName}
      className={className}
    >
      <circle cx="20" cy="20" r="18" fill="none" stroke="var(--brand)" strokeWidth="2.2" />
      <circle cx="20" cy="23" r="12" fill="none" stroke="var(--brand)" strokeWidth="2.2" />
      <circle cx="20" cy="26.5" r="6.5" fill="var(--brand)" />
    </svg>
  );
}
