import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BrandDto } from './brands.controller';
import { BrandsService } from './brands.service';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** What the admin panel sends when saving the «وضعیت شبکه» tab (plus the rest of the form). */
const body = {
  appName: 'HMRay',
  shortName: 'HMRay',
  tagline: '',
  purchaseVia: 'store',
  purchaseInbounds: [],
  uptimeUrl: 'https://uptime.hmray.pro',
  uptimeSlug: 'hmray-uptime',
  uptimeKey: 'sk_example_key',
  renewalVia: 'local',
  renewalPanelId: null,
  plans: [],
};

describe('saving NeoUptime settings', () => {
  it('passes validation and is written to the brand', async () => {
    // The real global pipe from main.ts.
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const dto = await pipe.transform(body, { type: 'body', metatype: BrandDto });

    const written: Record<string, unknown>[] = [];
    const row = { id: 'b1', orgId: 'o1', slug: 'hm', renewalPanelId: null, defaultLocale: 'fa' };
    const prisma = {
      brand: { findFirst: vi.fn().mockResolvedValue(row), update: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ brand: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => written.push(data)), updateMany: vi.fn() } }),
      ),
    };
    const svc = new BrandsService(
      prisma as never,
      { log: vi.fn() } as never,
      { getOrThrow: () => KEY, get: () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(svc, 'get').mockResolvedValue({} as never);
    await svc.update({ id: 'u1', orgId: 'o1', role: 'ORG_ADMIN' } as never, 'b1', dto);

    expect(written[0]).toMatchObject({ uptimeUrl: 'https://uptime.hmray.pro', uptimeSlug: 'hmray-uptime' });
    expect(typeof written[0].uptimeKeyEnc).toBe('string');
  });
});
