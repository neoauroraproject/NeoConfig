import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const v = (name: string) => `var(--${name})`;

const config: Config = {
  // Hover styles only where a real pointer can hover (no sticky hover after a tap).
  future: { hoverOnlyWhenSupported: true },
  // Resolve globs from this file, not the cwd (dev may run from the repo root).
  content: { relative: true, files: ['./src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        sunk: v('surface-sunk'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        'ink-3': v('ink-3'),
        line: v('line'),
        brand: v('brand'),
        accent: v('accent'),
        signal: v('signal'),
        nav: v('nav'),
        'nav-ink': v('nav-ink'),
        'on-ink': v('on-ink'),
      },
      fontFamily: {
        sans: ['Vazirmatn', 'Tahoma', 'system-ui', 'sans-serif'],
        num: ['Unbounded', 'Vazirmatn', 'sans-serif'],
      },
      boxShadow: {
        raise: v('raise'),
        'raise-sm': v('raise-sm'),
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
    },
  },
  plugins: [
    // Storefront breakpoints apply only inside the real app (.sf-root), never in the
    // admin's phone preview, where the window is wide but the frame is a phone.
    plugin(({ addVariant }) => {
      addVariant('tab', '@media (min-width: 640px) { .sf-root & }');
      addVariant('wide', '@media (min-width: 1024px) { .sf-root & }');
    }),
  ],
};

export default config;
