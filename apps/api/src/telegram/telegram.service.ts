import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../common/crypto/secret.crypto';

export interface TelegramTarget {
  appName: string;
  telegramBotTokenEnc: string | null;
  telegramChatId: string | null;
}

export interface RenewalNotice {
  id: string;
  displayName: string | null;
  subId: string;
  planTitle: string;
  price: string;
  days: number;
  gb: number;
  users?: number;
  mode?: string;
  payerName: string | null;
  payerNote: string | null;
}

type Markup = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/** callback_data for the inline buttons: nc:a:<renewalId> / nc:r:<renewalId> */
export function parseCallback(data: string | undefined): { approve: boolean; id: string } | null {
  const m = /^nc:([ar]):([a-z0-9]{10,40})$/.exec(data || '');
  return m ? { approve: m[1] === 'a', id: m[2] } : null;
}

/**
 * The sales team's Telegram channel for renewals: each receipt arrives with
 * its photo and Approve/Reject buttons (handled by TelegramWebhookController).
 * Uses the brand's own bot, so each reseller can point it at their own group.
 * TELEGRAM_API_BASE lets servers that cannot reach api.telegram.org use a relay.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(t: TelegramTarget) {
    return Boolean(t.telegramBotTokenEnc && t.telegramChatId);
  }

  receiptCaption(t: TelegramTarget, r: RenewalNotice) {
    const users = r.users ? ` · ${r.users === 1 ? 'تک‌کاربره' : `${r.users} کاربره`}` : '';
    const volume = r.mode === 'reset' ? (r.gb > 0 ? `${r.gb} گیگ (صفر شدن مصرف)` : 'نامحدود') : r.gb > 0 ? `+${r.gb} گیگ` : 'بدون حجم اضافه';
    return [
      `🧾 <b>رسید تمدید جدید</b> · ${esc(t.appName)}`,
      '',
      `👤 ${esc(r.displayName || r.subId)}`,
      `📦 ${esc(r.planTitle)} — ${esc(r.price)}`,
      `⏱ ${r.days > 0 ? `+${r.days} روز` : 'بدون تغییر زمان'} · ${volume}${users}`,
      r.payerName ? `💳 واریزکننده: ${esc(r.payerName)}` : null,
      r.payerNote ? `📝 ${esc(r.payerNote)}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n');
  }

  async renewalReceived(t: TelegramTarget, r: RenewalNotice, receipt?: { mime: string; data: Buffer }) {
    const text = this.receiptCaption(t, r);
    const markup: Markup = {
      inline_keyboard: [
        [
          { text: '✅ تأیید و تمدید', callback_data: `nc:a:${r.id}` },
          { text: '❌ رد', callback_data: `nc:r:${r.id}` },
        ],
      ],
    };
    if (receipt) return this.sendPhoto(t, text, receipt, markup);
    return this.sendMessage(t, text, false, markup);
  }

  async renewalDecided(
    t: TelegramTarget,
    r: Pick<RenewalNotice, 'displayName' | 'subId' | 'planTitle'>,
    decision: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null },
  ) {
    return this.sendMessage(
      t,
      `${decisionLine(decision)}\n👤 ${esc(r.displayName || r.subId)} · ${esc(r.planTitle)}${decision.note ? `\n📝 ${esc(decision.note)}` : ''}`,
    );
  }

  async test(t: TelegramTarget) {
    return this.sendMessage(t, `🔔 اعلان‌های تمدید <b>${esc(t.appName)}</b> به این گفتگو می‌آید.`, true);
  }

  /**
   * Points the bot's webhook at this server so button taps reach us.
   * Telegram only calls HTTPS URLs; on plain-HTTP installs buttons stay inactive.
   */
  async registerWebhook(t: TelegramTarget & { id: string; telegramWebhookSecret: string | null }) {
    const app = (this.config.get<string>('APP_URL') || '').replace(/\/+$/, '');
    if (!this.isConfigured(t) || !t.telegramWebhookSecret) return { ok: false, message: 'Telegram is not configured' };
    if (!app.startsWith('https://')) return { ok: false, message: 'Buttons need the site on HTTPS (APP_URL)' };
    const res = await this.api(t, 'setWebhook', {
      url: `${app}/api/v1/telegram/webhook/${t.id}`,
      secret_token: t.telegramWebhookSecret,
      allowed_updates: ['callback_query'],
    });
    return res.ok ? { ok: true, message: 'Buttons active' } : { ok: false, message: res.error };
  }

  async answerCallback(t: TelegramTarget, callbackId: string, text: string) {
    await this.api(t, 'answerCallbackQuery', { callback_query_id: callbackId, text: text.slice(0, 190) });
  }

  /** Replace the buttons with the outcome on the original receipt message. */
  async markDecided(
    t: TelegramTarget,
    message: { chatId: number | string; messageId: number; isPhoto: boolean; caption: string },
    line: string,
  ) {
    const text = `${message.caption}\n\n${line}`.slice(0, message.isPhoto ? 1024 : 4096);
    await this.api(t, message.isPhoto ? 'editMessageCaption' : 'editMessageText', {
      chat_id: message.chatId,
      message_id: message.messageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
      ...(message.isPhoto ? { caption: text } : { text }),
    });
  }

  private async sendMessage(t: TelegramTarget, text: string, throwOnError = false, markup?: Markup) {
    const res = await this.api(t, 'sendMessage', {
      chat_id: t.telegramChatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    });
    if (!res.ok && throwOnError) throw new Error(res.error);
    return res.ok;
  }

  private async sendPhoto(t: TelegramTarget, caption: string, receipt: { mime: string; data: Buffer }, markup?: Markup) {
    const form = new FormData();
    form.append('chat_id', String(t.telegramChatId));
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'HTML');
    if (markup) form.append('reply_markup', JSON.stringify(markup));
    form.append('photo', new Blob([new Uint8Array(receipt.data)], { type: receipt.mime }), 'receipt.jpg');
    const res = await this.api(t, 'sendPhoto', form);
    // Fall back to text (still with buttons) if the photo upload failed.
    return res.ok || this.sendMessage(t, caption, false, markup);
  }

  private async api(t: TelegramTarget, method: string, body: Record<string, unknown> | FormData): Promise<{ ok: boolean; error: string }> {
    if (!this.isConfigured(t)) return { ok: false, error: 'Telegram bot token and chat ID are required' };
    const token = decryptSecret(t.telegramBotTokenEnc!, this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    const base = (this.config.get<string>('TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, '');
    try {
      const isForm = body instanceof FormData;
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!json?.ok) throw new Error(json?.description || `Telegram HTTP ${res.status}`);
      return { ok: true, error: '' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Telegram ${method} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}

export function decisionLine(d: { approved: boolean; by: string; appliedOnPanel: boolean | null }) {
  if (!d.approved) return `❌ <b>رد شد</b> توسط ${esc(d.by)}`;
  const applied = d.appliedOnPanel === null ? '' : d.appliedOnPanel ? ' — روی پنل اعمال شد' : ' — روی پنل اعمال نشد، دستی تمدید کنید';
  return `✅ <b>تأیید شد</b> توسط ${esc(d.by)}${applied}`;
}

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
