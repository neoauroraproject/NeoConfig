import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { BrandsService } from '../brands/brands.service';
import { brandScope, requireOrg } from '../common/access/scope';
import { PrismaService } from '../prisma/prisma.service';
import { usageDay } from '../public/public.service';
import { parseUserAgent } from './user-agent';

const DAY = 86_400_000;

/**
 * Who uses the storefronts: one row per device (a random ID the app keeps)
 * and one per subscription a device added. No names, IPs or links are stored
 * beyond the subscription's display name the customer already sees.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brands: BrandsService,
  ) {}

  async track(input: {
    tenant?: string;
    deviceId: string;
    event: 'open' | 'add';
    standalone?: boolean;
    locale?: string;
    subId?: string;
    displayName?: string;
    userAgent?: string;
  }) {
    const brand = await this.brands.resolve(input.tenant);
    if (!brand) return { ok: false };
    const { platform, browser } = parseUserAgent(input.userAgent);
    const now = new Date();
    await this.prisma.appDevice.upsert({
      where: { brandId_deviceId: { brandId: brand.id, deviceId: input.deviceId } },
      create: {
        brandId: brand.id,
        deviceId: input.deviceId,
        platform,
        browser,
        standalone: Boolean(input.standalone),
        locale: input.locale?.slice(0, 8) || null,
        lastSeen: now,
      },
      update: {
        platform,
        browser,
        // Once installed, it stays counted as installed.
        ...(input.standalone ? { standalone: true } : {}),
        lastSeen: now,
        ...(input.event === 'open' ? { opens: { increment: 1 } } : {}),
      },
    });
    if (input.event === 'add' && input.subId) {
      await this.prisma.appSubscriptionAdd
        .create({
          data: {
            brandId: brand.id,
            deviceId: input.deviceId,
            subId: input.subId.slice(0, 120),
            displayName: input.displayName?.slice(0, 80) || null,
            platform,
          },
        })
        .catch((err) => {
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
        });
    }
    return { ok: true };
  }

  async overview(user: AuthUser, opts: { brandId?: string; days?: number }) {
    requireOrg(user);
    const days = Math.max(7, Math.min(90, Math.round(opts.days ?? 30)));
    const scope = { brand: brandScope(user), ...(opts.brandId ? { brandId: opts.brandId } : {}) };
    const now = Date.now();
    const since = new Date(now - (days - 1) * DAY);
    since.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [total, installed, newToday, new7, active7, devicesInRange, adds, addsTotal, recent, byPlatform, byBrowser, brands] = await Promise.all([
      this.prisma.appDevice.count({ where: scope }),
      this.prisma.appDevice.count({ where: { ...scope, standalone: true } }),
      this.prisma.appDevice.count({ where: { ...scope, firstSeen: { gte: today } } }),
      this.prisma.appDevice.count({ where: { ...scope, firstSeen: { gte: new Date(now - 7 * DAY) } } }),
      this.prisma.appDevice.count({ where: { ...scope, lastSeen: { gte: new Date(now - 7 * DAY) } } }),
      this.prisma.appDevice.findMany({ where: { ...scope, firstSeen: { gte: since } }, select: { firstSeen: true, platform: true } }),
      this.prisma.appSubscriptionAdd.findMany({ where: { ...scope, createdAt: { gte: since } }, select: { createdAt: true, subId: true } }),
      this.prisma.appSubscriptionAdd.groupBy({ by: ['subId'], where: scope }).then((r) => r.length),
      this.prisma.appSubscriptionAdd.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { createdAt: true, displayName: true, platform: true, deviceId: true, brand: { select: { appName: true, primaryColor: true } } },
      }),
      this.prisma.appDevice.groupBy({ by: ['platform'], where: scope, _count: { _all: true } }),
      this.prisma.appDevice.groupBy({ by: ['browser'], where: scope, _count: { _all: true } }),
      this.prisma.brand.findMany({ where: brandScope(user), select: { id: true, appName: true }, orderBy: { createdAt: 'asc' } }),
    ]);

    // Per-day series in the customers' local day.
    const series = new Map<string, { date: string; devices: number; subscriptions: number; byPlatform: Record<string, number> }>();
    for (let i = 0; i < days; i++) {
      const d = usageDay(new Date(since.getTime() + i * DAY + 12 * 3_600_000));
      series.set(d, { date: d, devices: 0, subscriptions: 0, byPlatform: {} });
    }
    for (const d of devicesInRange) {
      const row = series.get(usageDay(d.firstSeen));
      if (!row) continue;
      row.devices += 1;
      row.byPlatform[d.platform] = (row.byPlatform[d.platform] ?? 0) + 1;
    }
    const seenSubs = new Set<string>();
    for (const a of adds.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
      if (seenSubs.has(a.subId)) continue; // the same subscription on a second phone isn't a new one
      seenSubs.add(a.subId);
      const row = series.get(usageDay(a.createdAt));
      if (row) row.subscriptions += 1;
    }

    const sortCount = (rows: Array<{ _count: { _all: number } } & Record<string, unknown>>, key: string) =>
      rows.map((r) => ({ name: String(r[key]), count: r._count._all })).sort((a, b) => b.count - a.count);

    return {
      days,
      totals: {
        devices: total,
        installed,
        newToday,
        new7d: new7,
        active7d: active7,
        subscriptions: addsTotal,
        newSubscriptions: seenSubs.size,
      },
      series: [...series.values()],
      platforms: sortCount(byPlatform as never, 'platform'),
      browsers: sortCount(byBrowser as never, 'browser'),
      recent: recent.map((r) => ({
        at: r.createdAt.toISOString(),
        name: r.displayName,
        platform: r.platform,
        device: r.deviceId.slice(-5),
        brand: r.brand,
      })),
      brands,
    };
  }
}
