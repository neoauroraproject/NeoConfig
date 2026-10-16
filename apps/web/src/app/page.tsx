import { headers } from 'next/headers';
import { Storefront } from '@/components/storefront/Storefront';
import { brandMetadata, brandViewport, fetchBrand } from '@/lib/brand-server';

export const dynamic = 'force-dynamic';

/** The storefront for whichever custom domain this request arrived on. */
async function tenantFromHost() {
  const h = await headers();
  return (h.get('x-forwarded-host') || h.get('host') || 'default').split(',')[0].trim();
}

export async function generateMetadata() {
  const tenant = await tenantFromHost();
  return brandMetadata(await fetchBrand(tenant), tenant);
}

export async function generateViewport() {
  return brandViewport(await fetchBrand(await tenantFromHost()));
}

export default async function HomePage() {
  const tenant = await tenantFromHost();
  const brand = await fetchBrand(tenant);
  return <Storefront brand={brand} tenant={tenant} />;
}
