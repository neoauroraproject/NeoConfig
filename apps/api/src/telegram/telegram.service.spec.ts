import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { TelegramService, networkReason } from './telegram.service';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const config = { get: (k: string) => (k === 'APP_URL' ? 'https://neo.example.com' : undefined), getOrThrow: () => KEY };
const target = {
  appName: 'Arian <Net>',
  telegramBotTokenEnc: encryptSecret('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_12', KEY),
  telegramChatId: '-1001234',
};
const renewal = {
  id: 'r1',
  displayName: 'Ali',
  subId: 'ali777',
  planTitle: 'یک‌ماهه',
  price: '۱۵۰٬۰۰۰',
  days: 30,
  gb: 50,
  payerName: 'Sara',
  payerNote: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('TelegramService', () => {
  it('sends the receipt as a photo to every admin, with an escaped caption and the review buttons', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 77 } })));
    vi.stubGlobal('fetch', fetchMock);
    const sent = await new TelegramService(config as never).renewalReceived({ ...target, telegramChatId: '111, 222' }, renewal, {
      mime: 'image/jpeg',
      data: Buffer.from('jpeg'),
    });
    expect(sent).toEqual([
      { chatId: '111', messageId: 77, isPhoto: true },
      { chatId: '222', messageId: 77, isPhoto: true },
    ]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_12/sendPhoto');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('111');
    const caption = String(form.get('caption'));
    expect(caption).toContain('Arian &lt;Net&gt;');
    expect(caption).toContain('+30 روز');
    expect(JSON.parse(String(form.get('reply_markup'))).inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data)).toEqual(['nc:a:r1', 'nc:m:r1']);
  });

  it('falls back to a text message when the photo fails, and never throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: 'Bad Request' })))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const sent = await new TelegramService(config as never).renewalReceived(target, renewal, {
      mime: 'image/jpeg',
      data: Buffer.from('x'),
    });
    expect(sent).toEqual([]);
    expect(fetchMock.mock.calls[1][0]).toContain('/sendMessage');
  });

  it('closes every copy of a receipt after the decision', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ ok: true, result: {} })));
    vi.stubGlobal('fetch', fetchMock);
    await new TelegramService(config as never).closeReceipts(
      target,
      [{ chatId: '111', messageId: 5, isPhoto: true }, { chatId: '222', messageId: 6, isPhoto: true }],
      { approved: true, by: 'Sara', appliedOnPanel: true },
      'Ali · Plan',
    );
    const methods = fetchMock.mock.calls.map((c) => String(c[0]).split('/').pop());
    expect(methods).toEqual(['editMessageReplyMarkup', 'sendMessage', 'editMessageReplyMarkup', 'sendMessage']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).text).toContain('تأیید شد');
  });

  it('does nothing when the brand has no admins configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TelegramService(config as never);
    expect(await svc.renewalReceived({ ...target, telegramChatId: null }, renewal)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(svc.test({ ...target, telegramChatId: null })).rejects.toThrow();
  });

  it('goes through the brand relay and explains a blocked network', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { message_id: 3 } })));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TelegramService(config as never);
    await expect(svc.test(target)).rejects.toThrow(/دسترسی ندارد/);
    const sent = await svc.renewalReceived({ ...target, telegramApiBase: 'https://tg.example.workers.dev' }, renewal);
    expect(sent).toHaveLength(1);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/tg\.example\.workers\.dev\/bot/);
    expect(networkReason(new Error('Bad Request: chat not found'))).toBe('Bad Request: chat not found');
  });
});
