import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { isReviewer, parseCallback, TelegramService } from '../telegram/telegram.service';
import { RenewalsService } from './renewals.service';

interface Chat {
  id: number;
  username?: string;
}

interface Update {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number; username?: string; first_name?: string };
    message?: {
      message_id: number;
      chat: Chat;
      caption?: string;
      text?: string;
      photo?: unknown[];
    };
  };
  message?: { message_id: number; chat: Chat; text?: string; from?: { id: number } };
}

/**
 * The brand's Telegram team chat: Approve/Reject buttons under receipts and a
 * few commands (/pending, /stats, /help). Trust comes from two checks:
 * Telegram's secret token header (set when the webhook was registered) and
 * the update coming from the brand's configured chat.
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
    @Body() update: Update,
  ) {
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand?.telegramWebhookSecret || !secret || !safeEqual(secret, brand.telegramWebhookSecret)) return { ok: true };

    if (update.message?.text?.startsWith('/')) {
      const m = update.message;
      const cmd = m.text!.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
      if (isReviewer(brand.telegramChatId, m.from?.id, m.chat)) {
        await this.command(brand, m.chat.id, cmd);
      } else if (cmd === '/start' || cmd === '/id') {
        // How an admin finds the ID to enter in NeoConfig; nothing else is shared with strangers.
        await this.telegram.reply(
          brand,
          m.chat.id,
          `آیدی عددی شما: <code>${m.from?.id ?? m.chat.id}</code>\nاین عدد را در پنل NeoConfig ← برند ← اعلان، در «آیدی ادمین‌ها» وارد کنید تا رسیدها برایتان بیاید.`,
        );
      }
      return { ok: true };
    }

    const cb = update.callback_query;
    const action = parseCallback(cb?.data);
    if (!cb || !action || !cb.message) return { ok: true };

    const chat = cb.message.chat;
    if (!isReviewer(brand.telegramChatId, cb.from?.id, chat)) {
      await this.telegram.answerCallback(brand, cb.id, 'شما اجازهٔ تأیید یا رد رسیدها را ندارید', true);
      return { ok: true };
    }

    const by = cb.from?.username ? `@${cb.from.username}` : cb.from?.first_name || 'Telegram';
    const approve = action.kind !== 'reject';
    const note = action.kind === 'reject' ? action.note : undefined;
    const message = { chatId: chat.id, messageId: cb.message.message_id };
    try {
      const res = await this.renewals.decideFromTelegram(
        brand.id,
        action.id,
        { approve, apply: action.kind === 'approve', note },
        `${by} (Telegram)`,
      );
      const applied = 'appliedOnPanel' in res ? (res.appliedOnPanel as boolean | null) : null;
      await this.telegram.answerCallback(
        brand,
        cb.id,
        !approve ? 'رد شد' : applied ? 'تأیید و روی پنل تمدید شد ✅' : 'تأیید شد ✅',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed';
      // The panel refused or the account moved: keep the request open and offer a manual approval.
      if (action.kind === 'approve' && /panel/i.test(msg)) await this.telegram.offerManual(brand, message, action.id);
      await this.telegram.answerCallback(brand, cb.id, msg, true);
    }
    return { ok: true };
  }

  private async command(brand: Parameters<TelegramService['reply']>[0] & { id: string }, chatId: number, cmd: string) {
    if (cmd === '/pending') {
      const sent = await this.renewals.resendPending(brand.id);
      if (!sent) await this.telegram.reply(brand, chatId, '✅ درخواست در انتظاری نیست.');
      return;
    }
    if (cmd === '/stats') {
      const s = await this.renewals.stats(brand.id);
      await this.telegram.reply(
        brand,
        chatId,
        [
          '📈 <b>آمار تمدید</b>',
          '',
          `⏳ در انتظار: <b>${s.pending}</b>${s.failed ? ` (⚠️ ${s.failed} با خطای پنل)` : ''}`,
          `امروز: ✅ ${s.todayApproved} · ❌ ${s.todayRejected}`,
          `این ماه: ✅ ${s.monthApproved} · ❌ ${s.monthRejected}`,
        ].join('\n'),
      );
      return;
    }
    if (cmd === '/id') await this.telegram.reply(brand, chatId, `آیدی عددی شما: <code>${chatId}</code>`);
    if (cmd === '/help' || cmd === '/start') await this.telegram.help(brand, chatId);
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
