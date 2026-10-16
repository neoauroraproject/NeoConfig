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
  payerName: string | null;
  payerNote: string | null;
}

/**
 * Sends the sales team a Telegram message per renewal event. Uses the brand's
 * own bot, so each reseller can point notices at their own group.
 * TELEGRAM_API_BASE lets servers that cannot reach api.telegram.org use a relay.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(t: TelegramTarget) {
    return Boolean(t.telegramBotTokenEnc && t.telegramChatId);
  }

  async renewalReceived(t: TelegramTarget, r: RenewalNotice, receipt?: { mime: string; data: Buffer }) {
    const lines = [
      `🧾 <b>رسید تمدید جدید</b> · ${esc(t.appName)}`,
      '',
      `👤 ${esc(r.displayName || r.subId)}`,
      `📦 ${esc(r.planTitle)} — ${esc(r.price)}`,
      `⏱ ${r.days > 0 ? `${r.days} روز` : 'بدون تغییر زمان'} · ${r.gb > 0 ? `${r.gb} گیگ` : 'نامحدود'}`,
      r.payerName ? `💳 واریزکننده: ${esc(r.payerName)}` : null,
      r.payerNote ? `📝 ${esc(r.payerNote)}` : null,
      '',
      this.adminLink() ? `بررسی: ${this.adminLink()}` : 'برای بررسی به بخش «تمدیدها» در پنل مدیریت بروید.',
    ].filter((l) => l !== null) as string[];
    const text = lines.join('\n');
    if (receipt) return this.sendPhoto(t, text, receipt);
    return this.sendMessage(t, text);
  }

  async renewalDecided(
    t: TelegramTarget,
    r: Pick<RenewalNotice, 'displayName' | 'subId' | 'planTitle'>,
    decision: { approved: boolean; by: string; appliedOnPanel: boolean | null; note?: string | null },
  ) {
    const head = decision.approved ? '✅ <b>تمدید تأیید شد</b>' : '❌ <b>رسید رد شد</b>';
    const applied =
      decision.approved && decision.appliedOnPanel !== null
        ? decision.appliedOnPanel
          ? '\nروی پنل اعمال شد.'
          : '\nروی پنل اعمال نشد؛ دستی تمدید کنید.'
        : '';
    const note = decision.note ? `\n📝 ${esc(decision.note)}` : '';
    return this.sendMessage(
      t,
      `${head}\n👤 ${esc(r.displayName || r.subId)} · ${esc(r.planTitle)}\nتوسط ${esc(decision.by)}${applied}${note}`,
    );
  }

  async test(t: TelegramTarget) {
    return this.sendMessage(t, `🔔 اعلان‌های تمدید <b>${esc(t.appName)}</b> به این گفتگو می‌آید.`, true);
  }

  private async sendMessage(t: TelegramTarget, text: string, throwOnError = false) {
    return this.call(t, 'sendMessage', JSON.stringify({ chat_id: t.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true }), throwOnError, 'application/json');
  }

  private async sendPhoto(t: TelegramTarget, caption: string, receipt: { mime: string; data: Buffer }) {
    const form = new FormData();
    form.append('chat_id', String(t.telegramChatId));
    form.append('caption', caption.slice(0, 1024));
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([new Uint8Array(receipt.data)], { type: receipt.mime }), 'receipt.jpg');
    const ok = await this.call(t, 'sendPhoto', form, false);
    // Captions are capped; fall back to text if the photo upload failed.
    return ok || this.sendMessage(t, caption);
  }

  private async call(
    t: TelegramTarget,
    method: string,
    body: string | FormData,
    throwOnError: boolean,
    contentType?: string,
  ): Promise<boolean> {
    if (!this.isConfigured(t)) {
      if (throwOnError) throw new Error('Telegram bot token and chat ID are required');
      return false;
    }
    const token = decryptSecret(t.telegramBotTokenEnc!, this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    const base = (this.config.get<string>('TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, '');
    try {
      const res = await fetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: contentType ? { 'Content-Type': contentType } : undefined,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!json?.ok) throw new Error(json?.description || `Telegram HTTP ${res.status}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Telegram ${method} failed: ${msg}`);
      if (throwOnError) throw new Error(msg);
      return false;
    }
  }

  private adminLink() {
    const url = this.config.get<string>('APP_URL');
    return url && !url.includes('localhost') ? `${url.replace(/\/+$/, '')}/admin#renewals` : null;
  }
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
