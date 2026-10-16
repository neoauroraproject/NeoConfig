import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { ExpiryRemindersService } from './expiry-reminders.service';

const KEY = 'test-key';
const GB = 1024 ** 3;
const now = new Date('2026-10-16T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

/** Just enough Prisma for the reminder job, with the real unique (brandId, subId, kind) rule. */
function fakePrisma(follows: Array<{ subId: string; url: string }>) {
  const reminders: Array<{ brandId: string; subId: string; kind: string }> = [];
  return {
    reminders,
    brand: {
      findMany: async () => [{ id: 'b1', appName: 'Neo', defaultLocale: 'en', panels: [] }],
    },
    pushFollow: {
      findMany: async () => follows.map((f) => ({ subId: f.subId, urlEnc: encryptSecret(f.url, KEY) })),
    },
    expiryReminder: {
      findMany: async ({ where }: { where: { brandId: string } }) => reminders.filter((r) => r.brandId === where.brandId),
      create: async ({ data }: { data: { brandId: string; subId: string; kind: string } }) => {
        if (reminders.some((r) => r.brandId === data.brandId && r.subId === data.subId && r.kind === data.kind)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        reminders.push(data);
        return data;
      },
      deleteMany: async ({ where }: { where: { brandId: string; subId: string; kind: { in: string[] } } }) => {
        for (let i = reminders.length - 1; i >= 0; i--) {
          const r = reminders[i];
          if (r.brandId === where.brandId && r.subId === where.subId && where.kind.in.includes(r.kind)) reminders.splice(i, 1);
        }
        return { count: 0 };
      },
    },
  };
}

describe('ExpiryRemindersService', () => {
  let snapshot: Record<string, unknown>;
  const lookup = { lookup: vi.fn(async () => ({ snapshot })) };
  const push = { notifySubscription: vi.fn(async () => ({ sent: 1, total: 1 })) };
  const config = { get: () => undefined, getOrThrow: () => KEY };

  beforeEach(() => {
    lookup.lookup.mockClear();
    push.notifySubscription.mockClear();
    snapshot = {
      status: 'active',
      expiryAt: inDays(2),
      expiryKind: 'known',
      quotaKind: 'known',
      quotaBytes: 100 * GB,
      remainingBytes: 50 * GB,
      totalUsedBytes: 50 * GB,
    };
  });

  function service(prisma: ReturnType<typeof fakePrisma>) {
    return new ExpiryRemindersService(prisma as never, config as never, lookup as never, push as never);
  }

  it('looks each account up once and pushes one reminder per threshold', async () => {
    const prisma = fakePrisma([
      { subId: 'abc', url: 'https://panel.example.com/sub/abc' },
      { subId: 'abc', url: 'https://panel.example.com/sub/abc' },
    ]);
    const svc = service(prisma);

    expect(await svc.runOnce(now)).toEqual({ checked: 1, notified: 1, failed: 0 });
    expect(lookup.lookup).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 'https://panel.example.com/sub/abc');
    expect(push.notifySubscription).toHaveBeenCalledWith('b1', 'abc', expect.objectContaining({
      title: 'Your subscription ends soon',
      tag: 'reminder-abc',
    }));

    await svc.runOnce(now);
    expect(push.notifySubscription).toHaveBeenCalledTimes(1);
    expect(prisma.reminders).toEqual([{ brandId: 'b1', subId: 'abc', kind: 'days' }]);
  });

  it('sends the data reminder later even though the days one was already sent', async () => {
    const prisma = fakePrisma([{ subId: 'abc', url: 'https://panel.example.com/sub/abc' }]);
    const svc = service(prisma);
    await svc.runOnce(now);
    snapshot = { ...snapshot, remainingBytes: 5 * GB };
    await svc.runOnce(now);
    expect(push.notifySubscription).toHaveBeenCalledTimes(2);
    expect(push.notifySubscription).toHaveBeenLastCalledWith('b1', 'abc', expect.objectContaining({
      title: 'You are running out of data',
    }));
  });

  it('re-arms after a renewal and reminds again next cycle', async () => {
    const prisma = fakePrisma([{ subId: 'abc', url: 'https://panel.example.com/sub/abc' }]);
    const svc = service(prisma);
    await svc.runOnce(now);
    snapshot = { ...snapshot, expiryAt: inDays(32) };
    await svc.runOnce(now);
    expect(prisma.reminders).toEqual([]);
    snapshot = { ...snapshot, expiryAt: inDays(1) };
    await svc.runOnce(now);
    expect(push.notifySubscription).toHaveBeenCalledTimes(2);
  });

  it('keeps the sent record when the panel cannot be reached', async () => {
    const prisma = fakePrisma([{ subId: 'abc', url: 'https://panel.example.com/sub/abc' }]);
    const svc = service(prisma);
    await svc.runOnce(now);
    lookup.lookup.mockRejectedValueOnce(new Error('timeout'));
    expect(await svc.runOnce(now)).toEqual({ checked: 1, notified: 0, failed: 1 });
    expect(prisma.reminders).toHaveLength(1);
  });
});
