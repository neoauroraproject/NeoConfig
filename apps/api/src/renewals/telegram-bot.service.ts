import { Injectable } from '@nestjs/common';
import { Brand } from '@prisma/client';
import { isReviewer, parseCallback, TelegramService } from '../telegram/telegram.service';
import { RenewalsService } from './renewals.service';

interface Chat {
  id: number;
  username?: string;
}

export interface Update {
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
 * What the brand's bot does with one update (a command or a button press),
 * whether it came in by webhook or was fetched by the poller (servers whose
 * Telegram goes through a proxy or relay can't receive webhooks).
 */
@Injectable()
export class TelegramBotService {
  constructor(
    private readonly telegram: TelegramService,
    private readonly renewals: RenewalsService,
  ) {}

  async handle(brand: Brand, update: Update) {
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
        !approve
          ? 'رد شد'
          : applied
            ? 'تأیید و روی پنل تمدید شد ✅'
            : 'applyMessage' in res && /deliver/i.test(String(res.applyMessage))
              ? 'تأیید شد ✅ HMPanel سرویس را می‌سازد و لینکش به اپ خریدار می‌رسد'
              : 'تأیید شد ✅',
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
