import type { Config } from 'tailwindcss';

const v = (name: string) => `var(--${name})`;

const config: Config = {
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
  plugins: [],
};

export default config;
