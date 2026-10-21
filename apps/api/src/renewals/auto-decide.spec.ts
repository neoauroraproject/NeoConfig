import { describe, expect, it, vi } from 'vitest';
import { RenewalsService } from './renewals.service';

function setup(action: 'approve' | 'reject', renewOk = true) {
  const row = {
    id: 'r1', orgId: 'o1', brandId: 'b1', subId: 's1', status: 'PENDING', panelId: 'p1', clientRef: 'c1',
    days: 30, gb: 20, users: 0, mode: 'add', planTitle: 'Plan', displayName: 'Ali', kind: 'renewal',
    externalOrderId: null, deviceEndpoint: null, subUrlEnc: 'x',
  };
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    brand: {
      findMany: vi.fn().mockResolvedValue([{ id: 'b1', autoDecideMinutes: 10, autoDecideAction: action }]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    renewalRequest: {
      findMany: vi.fn().mockResolvedValue([row]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return row;
      }),
    },
    panelConnection: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', type: 'xui' }) },
  };
  const gateway = { renew: vi.fn().mockResolvedValue({ ok: renewOk, message: renewOk ? 'Renewed' : 'offline' }) };
  const push = { notifySubscription: vi.fn().mockResolvedValue({ sent: 1 }) };
  const audit = { log: vi.fn() };
  const svc = new RenewalsService(prisma as never, {} as never, {} as never, {} as never, gateway as never, push as never, audit as never, { isConfigured: () => false } as never, {} as never);
  return { svc, prisma, gateway, updates };
}

describe('auto decision', () => {
  it('approves overdue receipts and renews on the panel, marked as automatic', async () => {
    const { svc, prisma, gateway, updates } = setup('approve');
    await svc.autoDecide(new Date());
    expect(prisma.renewalRequest.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PENDING', autoTriedAt: null });
    expect(gateway.renew).toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'APPROVED', autoDecided: true, appliedOnPanel: true });
  });

  it('rejects when the brand chose reject', async () => {
    const { svc, gateway, updates } = setup('reject');
    await svc.autoDecide(new Date());
    expect(gateway.renew).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'REJECTED', autoDecided: true });
  });

  it('leaves it for a person when the panel refuses', async () => {
    const { svc, updates } = setup('approve', false);
    await svc.autoDecide(new Date());
    expect(updates.some((u) => u.status === 'APPROVED')).toBe(false);
  });
});
