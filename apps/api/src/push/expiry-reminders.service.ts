import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { decryptSecret } from '../common/crypto/secret.crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PublicService } from '../public/public.service';
import { PushService } from './push.service';
import { ReminderKind, checkThresholds, planReminders, reminderText } from './reminder-rules';

/**
 * Every few hours, re-check the accounts devices follow and push one reminder
 * per account when it is about to expire or run out of data.
 */
@Injectable()
export class ExpiryRemindersService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryRemindersService.name);
  private timers: ReturnType<typeof setTimeout>[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly lookup: PublicService,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap() {
    const minutes = Number(this.config.get<string>('PUSH_REMINDER_INTERVAL_MINUTES') ?? 360);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const every = minutes * 60_000;
    const tick = () => void this.runOnce().catch((err) => this.logger.error(`Reminder run failed: ${(err as Error).message}`));
    // First pass shortly after boot, so a restart never skips a whole cycle.
    const first = setTimeout(tick, Math.min(every, 2 * 60_000));
    const repeat = setInterval(tick, every);
    first.unref?.();
    repeat.unref?.();
    this.timers = [first, repeat];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async runOnce(now = new Date()) {
    if (this.running) return { checked: 0, notified: 0, failed: 0 };
    this.running = true;
    const stats = { checked: 0, notified: 0, failed: 0 };
    try {
      const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
      const brands = await this.prisma.brand.findMany({
        where: { active: true, expiryRemindersEnabled: true },
        include: { panels: { select: { id: true } } },
      });
      for (const brand of brands) {
        const follows = await this.prisma.pushFollow.findMany({
          where: { device: { brandId: brand.id } },
          orderBy: { updatedAt: 'desc' },
          select: { subId: true, urlEnc: true },
        });
        // One lookup per account, however many devices follow it.
        const urls = new Map<string, string>();
        for (const f of follows) if (!urls.has(f.subId)) urls.set(f.subId, f.urlEnc);
        if (!urls.size) continue;

        const sentRows = await this.prisma.expiryReminder.findMany({
          where: { brandId: brand.id, subId: { in: [...urls.keys()] } },
          select: { subId: true, kind: true },
        });
        const sent = new Map<string, ReminderKind[]>();
        for (const r of sentRows) sent.set(r.subId, [...(sent.get(r.subId) ?? []), r.kind as ReminderKind]);

        for (const [subId, urlEnc] of urls) {
          stats.checked += 1;
          let check;
          try {
            const result = await this.lookup.lookup(brand, decryptSecret(urlEnc, key));
            check = checkThresholds(result.snapshot, now);
          } catch {
            // Panel down or link gone: try again next run, keep what was sent.
            stats.failed += 1;
            continue;
          }
          const plan = planReminders(check.due, sent.get(subId) ?? []);
          if (plan.rearm.length) {
            await this.prisma.expiryReminder.deleteMany({ where: { brandId: brand.id, subId, kind: { in: plan.rearm } } });
          }
          const claimed = await this.claim(brand.id, subId, plan.send);
          if (!claimed.length) continue;
          const text = reminderText(claimed, check, brand.defaultLocale, brand.appName);
          await this.push.notifySubscription(brand.id, subId, { ...text, url: '/', tag: `reminder-${subId}` });
          stats.notified += 1;
        }
      }
      if (stats.checked) this.logger.log(`Reminders: checked ${stats.checked}, notified ${stats.notified}, failed ${stats.failed}`);
      return stats;
    } finally {
      this.running = false;
    }
  }

  /** Record each reminder before sending; the unique index keeps a second API instance from sending it twice. */
  private async claim(brandId: string, subId: string, kinds: ReminderKind[]) {
    const claimed: ReminderKind[] = [];
    for (const kind of kinds) {
      try {
        await this.prisma.expiryReminder.create({ data: { brandId, subId, kind } });
        claimed.push(kind);
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    return claimed;
  }
}
