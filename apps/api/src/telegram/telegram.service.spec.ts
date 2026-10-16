import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { TelegramService } from './telegram.service';

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
  it('sends the receipt as a photo with an escaped caption and admin link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await new TelegramService(config as never).renewalReceived(target, renewal, {
      mime: 'image/jpeg',
      data: Buffer.from('jpeg'),
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_12/sendPhoto');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('-1001234');
    const caption = String(form.get('caption'));
    expect(caption).toContain('Arian &lt;Net&gt;');
    expect(caption).toContain('30 روز');
    expect(caption).toContain('https://neo.example.com/admin#renewals');
  });

  it('falls back to a text message when the photo fails, and never throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, description: 'Bad Request' })))
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await new TelegramService(config as never).renewalReceived(target, renewal, {
      mime: 'image/jpeg',
      data: Buffer.from('x'),
    });
    expect(ok).toBe(false);
    expect(fetchMock.mock.calls[1][0]).toContain('/sendMessage');
  });

  it('does nothing when the brand has no bot configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new TelegramService(config as never);
    expect(await svc.renewalReceived({ ...target, telegramChatId: null }, renewal)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(svc.test({ ...target, telegramChatId: null })).rejects.toThrow(/required/);
  });
});
