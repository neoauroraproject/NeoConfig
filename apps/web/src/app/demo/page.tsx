import { Storefront } from '@/components/storefront/Storefront';
import { brandViewport, fetchBrand } from '@/lib/brand-server';
import { THEME_IDS, type Branding, type ThemeId } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ b?: string; theme?: string }> };

export async function generateViewport({ searchParams }: Props) {
  const { b } = await searchParams;
  return brandViewport(await fetchBrand(b || 'default'));
}

export const metadata = { title: 'Demo' };

/** Any brand with fake data — paste any https link. `?b=slug&theme=graphite` */
export default async function DemoPage({ searchParams }: Props) {
  const { b, theme } = await searchParams;
  const brand = await fetchBrand(b || 'default');
  const themed: Branding = {
    ...brand,
    theme: THEME_IDS.includes(theme as ThemeId) ? (theme as ThemeId) : brand.theme,
    themes: [...THEME_IDS],
    purchase: true,
    renewal: brand.renewal ?? {
      cardNumber: '6037991234567890',
      cardHolder: 'نمونه',
      bankName: 'بانک ملی',
      note: null,
      plans: [
        { id: 'p1', title: 'یک‌ماهه ۵۰ گیگ تک‌کاربره', days: 30, gb: 50, price: '۱۵۰٬۰۰۰ تومان', users: 1, mode: 'add', productId: 'd1', service: 'xui', category: 'آلمان' },
        { id: 'p2', title: 'سه‌ماهه ۱۵۰ گیگ دوکاربره', days: 90, gb: 150, price: '۴۲۰٬۰۰۰ تومان', users: 2, mode: 'add', productId: 'd2', service: 'xui', category: 'آلمان' },
        { id: 'p3', title: 'یک‌ماهه نامحدود', days: 30, gb: 0, price: '۲۲۰٬۰۰۰ تومان', users: 1, mode: 'reset', productId: 'd3', service: 'pasarguard' },
      ],
    },
  };
  return <Storefront brand={themed} tenant={`demo-${themed.slug}-${themed.theme}`} demo />;
}
