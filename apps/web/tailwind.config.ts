import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#F4F5F7',
          100: '#E6E8EC',
          200: '#C8CCD4',
          300: '#9AA1AE',
          400: '#6B7280',
          500: '#4B5563',
          600: '#374151',
          700: '#1F2430',
          800: '#151922',
          900: '#0F1115',
          950: '#0A0C10',
        },
        brand: {
          DEFAULT: 'var(--brand-primary)',
          accent: 'var(--brand-accent)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Segoe UI', 'Tahoma', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 40px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
