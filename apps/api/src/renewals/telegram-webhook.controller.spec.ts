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
  const telegram = { answerCallback: vi.fn(), markDecided: vi.fn(), offerManual: vi.fn(), say: vi.fn(), help: vi.fn() };
  const renewals = {
    decideFromTelegram: decide,
    resendPending: vi.fn().mockResolvedValue(0),
    stats: vi.fn().mockResolvedValue({ pending: 2, todayApproved: 1, todayRejected: 0, monthApproved: 9, monthRejected: 1, failed: 0 }),
  };
  const c = new TelegramWebhookController(prisma as never, telegram as never, renewals as never);
  return { c, telegram, decide, renewals };
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
    expect(decide).toHaveBeenCalledWith('b1', 'cmrenewal0001', { approve: true, apply: true, note: undefined }, '@sara (Telegram)');
    const [, message, line] = telegram.markDecided.mock.calls[0];
    expect(message).toMatchObject({ chatId: -100123, messageId: 9, isPhoto: true, caption: 'Receipt &lt;b&gt;' });
    expect(line).toContain('تأیید شد');
    expect(line).toContain('روی پنل اعمال شد');
  });

  it('reports failures back on the button', async () => {
    const { c, telegram } = setup(vi.fn().mockRejectedValue(new Error('Already decided')));
    await c.webhook('b1', 'secret-abc', update(-100123, 'nc:r:cmrenewal0001'));
    expect(telegram.answerCallback).toHaveBeenCalledWith(brand, 'cb1', 'Already decided', true);
    expect(telegram.markDecided).not.toHaveBeenCalled();
    expect(telegram.offerManual).not.toHaveBeenCalled();
  });

  it('rejects with the reason the button names', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'secret-abc', update(-100123, 'nc:x1:cmrenewal0001'));
    const [, , decision] = decide.mock.calls[0];
    expect(decision).toMatchObject({ approve: false, apply: false });
    expect(decision.note).toContain('مبلغ');
    expect(telegram.markDecided.mock.calls[0][2]).toContain('رد شد');
  });

  it('offers a manual approval when the panel refuses', async () => {
    const { c, telegram } = setup(vi.fn().mockRejectedValue(new Error('Panel did not accept the renewal: offline')));
    await c.webhook('b1', 'secret-abc', update());
    expect(telegram.offerManual).toHaveBeenCalledWith(brand, { chatId: -100123, messageId: 9 }, 'cmrenewal0001');
  });

  it('manual approval skips the panel', async () => {
    const { c, decide } = setup(vi.fn().mockResolvedValue({ ok: true, appliedOnPanel: null }));
    await c.webhook('b1', 'secret-abc', update(-100123, 'nc:m:cmrenewal0001'));
    expect(decide.mock.calls[0][2]).toMatchObject({ approve: true, apply: false });
  });

  it('answers /stats and /pending only in the team chat', async () => {
    const { c, telegram, renewals } = setup();
    const msg = (chatId: number, text: string) => ({ message: { message_id: 1, chat: { id: chatId }, text } });
    await c.webhook('b1', 'secret-abc', msg(-999, '/stats'));
    expect(telegram.say).not.toHaveBeenCalled();
    await c.webhook('b1', 'secret-abc', msg(-100123, '/stats@neo_bot'));
    expect(telegram.say.mock.calls[0][1]).toContain('در انتظار: <b>2</b>');
    await c.webhook('b1', 'secret-abc', msg(-100123, '/pending'));
    expect(renewals.resendPending).toHaveBeenCalledWith('b1');
    expect(telegram.say.mock.calls[1][1]).toContain('درخواست در انتظاری نیست');
  });
});
