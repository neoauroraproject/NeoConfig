import { describe, expect, it, vi } from 'vitest';
import { TelegramWebhookController } from './telegram-webhook.controller';

// Two admins by numeric Telegram ID; receipts reach them in private chats.
const brand = {
  id: 'b1',
  appName: 'Arian',
  telegramBotTokenEnc: 'enc',
  telegramChatId: '111,222',
  telegramWebhookSecret: 'secret-abc',
};

function setup(decide = vi.fn().mockResolvedValue({ ok: true, appliedOnPanel: true })) {
  const prisma = { brand: { findUnique: vi.fn().mockResolvedValue(brand) } };
  const telegram = { answerCallback: vi.fn(), offerManual: vi.fn(), reply: vi.fn(), help: vi.fn() };
  const renewals = {
    decideFromTelegram: decide,
    resendPending: vi.fn().mockResolvedValue(0),
    stats: vi.fn().mockResolvedValue({ pending: 2, todayApproved: 1, todayRejected: 0, monthApproved: 9, monthRejected: 1, failed: 0 }),
  };
  const c = new TelegramWebhookController(prisma as never, telegram as never, renewals as never);
  return { c, telegram, decide, renewals };
}

const tap = (fromId = 111, data = 'nc:a:cmrenewal0001') => ({
  callback_query: {
    id: 'cb1',
    data,
    from: { id: fromId, username: 'sara' },
    message: { message_id: 9, chat: { id: fromId }, caption: 'Receipt', photo: [{}] },
  },
});
const msg = (fromId: number, text: string) => ({ message: { message_id: 1, chat: { id: fromId }, from: { id: fromId }, text } });

describe('Telegram webhook', () => {
  it('ignores calls without the right secret', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'wrong', tap());
    await c.webhook('b1', undefined, tap());
    expect(decide).not.toHaveBeenCalled();
    expect(telegram.answerCallback).not.toHaveBeenCalled();
  });

  it('only listed admins may decide', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'secret-abc', tap(999));
    expect(decide).not.toHaveBeenCalled();
    expect(telegram.answerCallback).toHaveBeenCalledWith(brand, 'cb1', expect.stringContaining('اجازه'), true);
  });

  it('approves with auto renewal and acknowledges the tap', async () => {
    const { c, decide, telegram } = setup();
    await c.webhook('b1', 'secret-abc', tap(222));
    expect(decide).toHaveBeenCalledWith('b1', 'cmrenewal0001', { approve: true, apply: true, note: undefined }, '@sara (Telegram)');
    expect(telegram.answerCallback.mock.calls[0][2]).toContain('تمدید شد');
  });

  it('rejects with the reason the button names', async () => {
    const { c, decide } = setup();
    await c.webhook('b1', 'secret-abc', tap(111, 'nc:x1:cmrenewal0001'));
    const [, , decision] = decide.mock.calls[0];
    expect(decision).toMatchObject({ approve: false, apply: false });
    expect(decision.note).toContain('مبلغ');
  });

  it('reports failures back on the button and offers manual approval when the panel refuses', async () => {
    const { c, telegram } = setup(vi.fn().mockRejectedValue(new Error('Panel did not accept the renewal: offline')));
    await c.webhook('b1', 'secret-abc', tap());
    expect(telegram.offerManual).toHaveBeenCalledWith(brand, { chatId: 111, messageId: 9 }, 'cmrenewal0001');
    expect(telegram.answerCallback).toHaveBeenCalledWith(brand, 'cb1', expect.stringContaining('Panel'), true);
  });

  it('manual approval skips the panel', async () => {
    const { c, decide } = setup(vi.fn().mockResolvedValue({ ok: true, appliedOnPanel: null }));
    await c.webhook('b1', 'secret-abc', tap(111, 'nc:m:cmrenewal0001'));
    expect(decide.mock.calls[0][2]).toMatchObject({ approve: true, apply: false });
  });

  it('answers commands for admins and tells anyone else their own ID', async () => {
    const { c, telegram, renewals } = setup();
    await c.webhook('b1', 'secret-abc', msg(999, '/stats'));
    expect(renewals.stats).not.toHaveBeenCalled();
    await c.webhook('b1', 'secret-abc', msg(999, '/start'));
    expect(telegram.reply).toHaveBeenLastCalledWith(brand, 999, expect.stringContaining('<code>999</code>'));
    await c.webhook('b1', 'secret-abc', msg(111, '/stats@neo_bot'));
    expect(telegram.reply).toHaveBeenLastCalledWith(brand, 111, expect.stringContaining('در انتظار: <b>2</b>'));
    await c.webhook('b1', 'secret-abc', msg(222, '/pending'));
    expect(renewals.resendPending).toHaveBeenCalledWith('b1');
  });
});
