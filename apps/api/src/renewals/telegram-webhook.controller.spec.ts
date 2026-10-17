import { describe, expect, it, vi } from 'vitest';
import { TelegramWebhookController } from './telegram-webhook.controller';

const brand = {
  id: 'b1',
  appName: 'Arian',
  telegramBotTokenEnc: 'enc',
  telegramChatId: '-100123',
  telegramWebhookSecret: 'secret-abc',
};

function setup(decide = vi.fn().mockResolvedValue({ ok: true, appliedOnPanel: true })) {
  const prisma = { brand: { findUnique: vi.fn().mockResolvedValue(brand) } };
  const telegram = { answerCallback: vi.fn(), markDecided: vi.fn() };
  const renewals = { decideFromTelegram: decide };
  const c = new TelegramWebhookController(prisma as never, telegram as never, renewals as never);
  return { c, telegram, decide };
}

const update = (chatId = -100123, data = 'nc:a:cmrenewal0001') => ({
  callback_query: {
    id: 'cb1',
    data,
    from: { id: 1, username: 'sara' },
    message: { message_id: 9, chat: { id: chatId }, caption: 'Receipt <b>', photo: [{}] },
  },
});

describe('Telegram webhook', () => {
  it('ignores calls without the right secret', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'wrong', update());
    await c.webhook('b1', undefined, update());
    expect(decide).not.toHaveBeenCalled();
    expect(telegram.answerCallback).not.toHaveBeenCalled();
  });

  it('refuses taps from another chat', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'secret-abc', update(-999));
    expect(decide).not.toHaveBeenCalled();
    expect(telegram.answerCallback).toHaveBeenCalledWith(brand, 'cb1', expect.stringContaining('not allowed'));
  });

  it('approves, then replaces the buttons with the outcome', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'secret-abc', update());
    expect(decide).toHaveBeenCalledWith('b1', 'cmrenewal0001', true, '@sara (Telegram)');
    const [, message, line] = telegram.markDecided.mock.calls[0];
    expect(message).toMatchObject({ chatId: -100123, messageId: 9, isPhoto: true, caption: 'Receipt &lt;b&gt;' });
    expect(line).toContain('تأیید شد');
    expect(line).toContain('روی پنل اعمال شد');
  });

  it('reports failures back on the button', async () => {
    const { c, telegram } = setup(vi.fn().mockRejectedValue(new Error('Already decided')));
    await c.webhook('b1', 'secret-abc', update(-100123, 'nc:r:cmrenewal0001'));
    expect(telegram.answerCallback).toHaveBeenCalledWith(brand, 'cb1', 'Already decided');
    expect(telegram.markDecided).not.toHaveBeenCalled();
  });
});
