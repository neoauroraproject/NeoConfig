import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramBotService, Update } from './telegram-bot.service';

/**
 * The brand's Telegram team chat by webhook: Telegram's secret token header
 * (set when the webhook was registered) proves the call; TelegramBotService
 * does the rest (also for updates the poller fetches).
 */
@Controller('api/v1/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
  ) {}

  @Post('webhook/:brandId')
  @HttpCode(200)
  @SkipThrottle()
  async webhook(
    @Param('brandId') brandId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: Update,
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand?.telegramWebhookSecret || !secret || !safeEqual(secret, brand.telegramWebhookSecret)) return { ok: true };
    return this.bot.handle(brand, update);
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Telegram returns captions as plain text; re-escape before sending them back as HTML. */
export function escapeKept(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
