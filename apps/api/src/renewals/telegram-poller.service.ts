import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { TelegramBotService, Update } from './telegram-bot.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bots whose Telegram goes through a proxy or relay can send but never receive
 * a webhook, so their buttons and commands would do nothing. For those, keep a
 * long poll (getUpdates) running per bot through the same route.
 */
@Injectable()
export class TelegramPollerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollerService.name);
  private readonly running = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly bot: TelegramBotService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 30_000);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Start a loop for every bot that needs one (new bots, changed settings). */
  async tick() {
    const brands = await this.prisma.brand
      .findMany({ where: { telegramBotTokenEnc: { not: null } }, select: { id: true } })
      .catch(() => []);
    for (const { id } of brands) {
      if (this.running.has(id)) continue;
      const brand = await this.prisma.brand.findUnique({ where: { id } }).catch(() => null);
      if (brand && this.telegram.usesPolling(brand)) void this.loop(id);
    }
  }

  private async loop(brandId: string) {
    this.running.add(brandId);
    let offset = 0;
    let failures = 0;
    let webhookCleared = false;
    try {
      while (!this.stopped) {
        // Re-read each round: the token, admins or route may have changed (or polling is no longer needed).
        const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
        if (!brand?.telegramBotTokenEnc || !this.telegram.usesPolling(brand)) return;
        if (!webhookCleared) {
          webhookCleared = (await this.telegram.clearWebhook(brand)).ok;
        }
        const res = await this.telegram.getUpdates(brand, offset);
        if (!res.ok) {
          failures += 1;
          if (/webhook/i.test(res.error)) webhookCleared = false;
          if (failures === 3) this.logger.warn(`Telegram updates for brand ${brandId} keep failing: ${res.error}`);
          await sleep(Math.min(60_000, 5_000 * failures));
          continue;
        }
        failures = 0;
        for (const u of res.updates) {
          offset = Math.max(offset, u.update_id + 1);
          await this.bot.handle(brand, u as unknown as Update).catch((err) =>
            this.logger.warn(`Telegram update ${u.update_id} failed: ${err instanceof Error ? err.message : err}`),
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Telegram poller for brand ${brandId} stopped: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.running.delete(brandId);
    }
  }
}
