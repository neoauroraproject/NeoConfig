import { Storefront } from '@/components/storefront/Storefront';
import { brandMetadata, brandViewport, fetchBrand } from '@/lib/brand-server';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

/** Storefront addressed by slug, for brands without their own domain yet. */
export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  return brandMetadata(await fetchBrand(slug), slug);
}

export async function generateViewport({ params }: Params) {
  const { slug } = await params;
  return brandViewport(await fetchBrand(slug));
}

export default async function BrandPage({ params }: Params) {
  const { slug } = await params;
  const brand = await fetchBrand(slug);
  return <Storefront brand={brand} tenant={slug} />;
}
