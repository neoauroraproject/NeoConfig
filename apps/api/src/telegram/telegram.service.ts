import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyAgent } from 'undici';
import { decryptSecret } from '../common/crypto/secret.crypto';
import { HELP_TEXT, Markup, RenewalNotice, decisionLine, esc, receiptCaption, reviewKeyboard } from './review';

export interface TelegramTarget {
  appName: string;
  telegramBotTokenEnc: string | null;
  /** Admins' numeric Telegram IDs, comma separated (a group ID still works). */
  telegramChatId: string | null;
  /** Relay for servers that can't reach api.telegram.org (e.g. a Cloudflare Worker). */
  telegramApiBase?: string | null;
  /** HTTP proxy to reach Telegram through, e.g. a local xray client: http://127.0.0.1:10809 */
  telegramProxy?: string | null;
}

/** A receipt message as sent to one admin, so every copy can be closed later. */
export interface SentReceipt {
  chatId: string;
  messageId: number;
  isPhoto: boolean;
}

export type { CallbackAction, RenewalNotice, ReviewInfo } from './review';
export { decisionLine, esc, parseCallback } from './review';

/** The brand's admins (or a legacy group) that receive receipts and may decide them. */
export function recipients(raw: string | null | undefined): string[] {
  return [...new Set((raw || '').split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 10);
}

/** True when this Telegram user (or the chat it wrote in) is one of the brand's reviewers. */
export function isReviewer(raw: string | null | undefined, fromId: number | undefined, chat?: { id: number; username?: string }) {
  const list = recipients(raw);
  if (fromId !== undefined && list.includes(String(fromId))) return true;
  if (!chat) return false;
  return list.some(
    (r) => r === String(chat.id) || (r.startsWith('@') && chat.username && r.slice(1).toLowerCase() === chat.username.toLowerCase()),
  );
}

/**
 * The brand's own renewal bot: every receipt goes, with its photo and
 * Approve/Reject buttons, to each admin's private chat (handled by
 * TelegramWebhookController). TELEGRAM_API_BASE lets servers that cannot
 * reach api.telegram.org use a relay.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(t: TelegramTarget) {
    return Boolean(t.telegramBotTokenEnc && recipients(t.telegramChatId).length);
  }

  receiptCaption(t: TelegramTarget, r: RenewalNotice) {
    return receiptCaption(t.appName, r);
  }

  /** Sends the receipt to every admin; returns each copy so it can be closed after the decision. */
  async renewalReceived(t: TelegramTarget, r: RenewalNotice, receipt?: { mime: string; data: Buffer }): Promise<SentReceipt[]> {
    const text = this.receiptCaption(t, r);
    const markup = reviewKeyboard(r.id);
    const sent: SentReceipt[] = [];
    for (const chatId of recipients(t.telegramChatId)) {
      const ref = receipt ? await this.sendPhotoTo(t, chatId, text, receipt, markup) : await this.sendTo(t, chatId, text, markup);
      if (ref) sent.push(ref);
    }
    return sent;
  }

  /**
   * A decision was made (button, admin panel, timer or HMPanel): take the
   * buttons off every admin's copy and post the outcome under it.
   */
  async closeReceipts(
    t: TelegramTarget,
    refs: SentReceipt[],
    decision: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null },
    summary: string,
  ) {
    const line = `${decisionLine(decision)}\n${summary}`;
    if (!refs.length) {
      // Sent before receipts were tracked (or the copies are gone): say it once to each admin.
      for (const chatId of recipients(t.telegramChatId)) await this.sendTo(t, chatId, line);
      return;
    }
    for (const ref of refs) {
      await this.api(t, 'editMessageReplyMarkup', { chat_id: ref.chatId, message_id: ref.messageId, reply_markup: { inline_keyboard: [] } });
      await this.api(t, 'sendMessage', {
        chat_id: ref.chatId,
        text: line,
        parse_mode: 'HTML',
        reply_parameters: { message_id: ref.messageId, allow_sending_without_reply: true },
      });
    }
  }

  /** One message to every admin (HMPanel store notices, test). Returns how many were delivered. */
  async broadcast(t: TelegramTarget, text: string) {
    let ok = 0;
    const errors: string[] = [];
    for (const chatId of recipients(t.telegramChatId)) {
      const res = await this.api(t, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
      if (res.ok) ok += 1;
      else errors.push(`${chatId}: ${friendly(res.error)}`);
    }
    return { ok, errors };
  }

  async test(t: TelegramTarget) {
    const res = await this.broadcast(t, `🔔 رسیدهای تمدید <b>${esc(t.appName)}</b> برای شما اینجا می‌آید و با دکمه‌ها تأیید یا رد می‌کنید.`);
    if (!res.ok) throw new Error(res.errors.join(' · ') || 'No admin received the message');
    return res;
  }

  /**
   * Points the bot's webhook at this server so button taps and commands reach us.
   * Telegram only calls HTTPS URLs; on plain-HTTP installs buttons stay inactive.
   */
  async registerWebhook(t: TelegramTarget & { id: string; telegramWebhookSecret: string | null }) {
    const app = (this.config.get<string>('APP_URL') || '').replace(/\/+$/, '');
    if (!t.telegramBotTokenEnc || !t.telegramWebhookSecret) return { ok: false, message: 'Telegram is not configured' };
    if (!app.startsWith('https://')) return { ok: false, message: 'Buttons need the site on HTTPS (APP_URL)' };
    const res = await this.api(t, 'setWebhook', {
      url: `${app}/api/v1/telegram/webhook/${t.id}`,
      secret_token: t.telegramWebhookSecret,
      allowed_updates: ['callback_query', 'message'],
    });
    if (res.ok) {
      await this.api(t, 'setMyCommands', {
        commands: [
          { command: 'pending', description: 'درخواست‌های در انتظار' },
          { command: 'stats', description: 'آمار تمدید' },
          { command: 'id', description: 'آیدی عددی من' },
          { command: 'help', description: 'راهنما' },
        ],
      });
    }
    return res.ok ? { ok: true, message: 'Buttons active' } : { ok: false, message: res.error };
  }

  async answerCallback(t: TelegramTarget, callbackId: string, text: string, alert = false) {
    await this.api(t, 'answerCallbackQuery', { callback_query_id: callbackId, text: text.slice(0, 190), show_alert: alert });
  }

  /** Reply in one chat (commands, /start). */
  async reply(t: TelegramTarget, chatId: number | string, text: string) {
    return Boolean(await this.sendTo(t, String(chatId), text));
  }

  help(t: TelegramTarget, chatId: number | string) {
    return this.reply(t, chatId, HELP_TEXT);
  }

  /** The panel refused the renewal: swap in "approve, I'll renew by hand" so the request isn't stuck. */
  async offerManual(t: TelegramTarget, message: { chatId: number | string; messageId: number }, id: string) {
    await this.api(t, 'editMessageReplyMarkup', {
      chat_id: message.chatId,
      message_id: message.messageId,
      reply_markup: reviewKeyboard(id, { manual: true }),
    });
  }

  private async sendTo(t: TelegramTarget, chatId: string, text: string, markup?: Markup): Promise<SentReceipt | null> {
    const res = await this.api(t, 'sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    });
    const id = (res.result as { message_id?: number } | undefined)?.message_id;
    return res.ok && id ? { chatId, messageId: id, isPhoto: false } : null;
  }

  private async sendPhotoTo(
    t: TelegramTarget,
    chatId: string,
    caption: string,
    receipt: { mime: string; data: Buffer },
    markup?: Markup,
  ): Promise<SentReceipt | null> {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'HTML');
    if (markup) form.append('reply_markup', JSON.stringify(markup));
    form.append('photo', new Blob([new Uint8Array(receipt.data)], { type: receipt.mime }), 'receipt.jpg');
    const res = await this.api(t, 'sendPhoto', form);
    const id = (res.result as { message_id?: number } | undefined)?.message_id;
    if (res.ok && id) return { chatId, messageId: id, isPhoto: true };
    // Fall back to text (still with buttons) if the photo upload failed.
    return this.sendTo(t, chatId, caption, markup);
  }

  private async api(
    t: TelegramTarget,
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<{ ok: boolean; error: string; result?: unknown }> {
    if (!t.telegramBotTokenEnc) return { ok: false, error: 'Telegram bot token is required' };
    const token = decryptSecret(t.telegramBotTokenEnc, this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    const base = (t.telegramApiBase || this.config.get<string>('TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, '');
    const proxy = t.telegramProxy || this.config.get<string>('TELEGRAM_PROXY') || '';
    try {
      const isForm = body instanceof FormData;
      const init: RequestInit & { dispatcher?: unknown } = {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      };
      if (proxy) init.dispatcher = this.agent(proxy);
      const res = await fetch(`${base}/bot${token}/${method}`, init);
      const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: unknown } | null;
      if (!json?.ok) throw new Error(json?.description || `Telegram HTTP ${res.status}`);
      return { ok: true, error: '', result: json.result };
    } catch (err) {
      const msg = networkReason(err);
      this.logger.warn(`Telegram ${method} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  private agents = new Map<string, ProxyAgent>();

  private agent(url: string) {
    let a = this.agents.get(url);
    if (!a) {
      a = new ProxyAgent(url);
      this.agents.set(url, a);
    }
    return a;
  }
}

/**
 * "fetch failed" hides the real cause in err.cause; turn the usual ones into
 * something an admin can act on (most often: Telegram is filtered on this server).
 */
export function networkReason(err: unknown): string {
  const e = err as { message?: string; name?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code || '';
  const text = `${e?.message || ''} ${e?.cause?.message || ''}`;
  if (e?.name === 'TimeoutError' || /timeout|aborted/i.test(text) || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
    return 'سرور به تلگرام دسترسی ندارد (اتصال تمام نشد) — آدرس رله یا پروکسی را در تنظیمات ربات بگذارید';
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code) || /fetch failed/i.test(text)) {
    return `سرور به تلگرام دسترسی ندارد${code ? ` (${code})` : ''} — آدرس رله یا پروکسی را در تنظیمات ربات بگذارید`;
  }
  return e?.message || String(err);
}

/** Telegram's most common refusals, in words an admin can act on. */
function friendly(error: string) {
  if (/chat not found|bot can't initiate|user not found/i.test(error)) return 'این ادمین هنوز به ربات /start نزده';
  if (/blocked by the user/i.test(error)) return 'این ادمین ربات را بلاک کرده';
  if (/unauthorized/i.test(error)) return 'توکن ربات نامعتبر است';
  return error;
}
