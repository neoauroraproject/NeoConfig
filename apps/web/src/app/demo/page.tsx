import { Storefront } from '@/components/storefront/Storefront';
import { brandViewport, fetchBrand } from '@/lib/brand-server';
import type { Branding } from '@/lib/api';

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
    theme: theme === 'graphite' || theme === 'sage' || theme === 'mist' ? theme : brand.theme,
    renewal: brand.renewal ?? {
      cardNumber: '6037991234567890',
      cardHolder: 'نمونه',
      bankName: 'بانک ملی',
      note: null,
      plans: [
        { id: 'p1', title: 'یک‌ماهه ۵۰ گیگ تک‌کاربره', days: 30, gb: 50, price: '۱۵۰٬۰۰۰ تومان', users: 1, mode: 'add' },
        { id: 'p2', title: 'سه‌ماهه ۱۵۰ گیگ دوکاربره', days: 90, gb: 150, price: '۴۲۰٬۰۰۰ تومان', users: 2, mode: 'add' },
      ],
    },
  };
  return <Storefront brand={themed} tenant={`demo-${themed.slug}-${themed.theme}`} demo />;
}
