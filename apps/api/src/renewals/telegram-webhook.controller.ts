import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { decisionLine, parseCallback, TelegramService } from '../telegram/telegram.service';
import { RenewalsService } from './renewals.service';

interface CallbackUpdate {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number; username?: string; first_name?: string };
    message?: {
      message_id: number;
      chat: { id: number; username?: string };
      caption?: string;
      text?: string;
      photo?: unknown[];
    };
  };
}

/**
 * Approve/Reject buttons under renewal receipts in the brand's Telegram group.
 * Trust comes from two checks: Telegram's secret token header (set when the
 * webhook was registered) and the message being in the brand's configured chat.
 */
@Controller('api/v1/telegram')
export class TelegramWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly renewals: RenewalsService,
  ) {}

  @Post('webhook/:brandId')
  @HttpCode(200)
  @SkipThrottle()
  async webhook(
    @Param('brandId') brandId: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: CallbackUpdate,
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand?.telegramWebhookSecret || !secret || !safeEqual(secret, brand.telegramWebhookSecret)) return { ok: true };

    const cb = update.callback_query;
    const action = parseCallback(cb?.data);
    if (!cb || !action || !cb.message) return { ok: true };

    const chat = cb.message.chat;
    const configured = (brand.telegramChatId || '').trim();
    const sameChat =
      configured === String(chat.id) ||
      (configured.startsWith('@') && chat.username && configured.slice(1).toLowerCase() === chat.username.toLowerCase());
    if (!sameChat) {
      await this.telegram.answerCallback(brand, cb.id, 'This chat is not allowed to decide renewals');
      return { ok: true };
    }

    const by = cb.from?.username ? `@${cb.from.username}` : cb.from?.first_name || 'Telegram';
    try {
      const res = await this.renewals.decideFromTelegram(brand.id, action.id, action.approve, `${by} (Telegram)`);
      const applied = 'appliedOnPanel' in res ? (res.appliedOnPanel as boolean | null) : null;
      await this.telegram.markDecided(
        brand,
        {
          chatId: chat.id,
          messageId: cb.message.message_id,
          isPhoto: Boolean(cb.message.photo),
          caption: escapeKept(cb.message.caption ?? cb.message.text ?? ''),
        },
        decisionLine({ approved: action.approve, by, appliedOnPanel: applied }),
      );
      await this.telegram.answerCallback(brand, cb.id, action.approve ? 'Approved ✅' : 'Rejected');
    } catch (err) {
      await this.telegram.answerCallback(brand, cb.id, err instanceof Error ? err.message : 'Failed');
    }
    return { ok: true };
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Telegram returns captions as plain text; re-escape before sending them back as HTML. */
function escapeKept(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
