import { describe, expect, it, vi } from 'vitest';
import { CustomersService, cleanUsername, generatePassword } from './customers.service';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const brand = { id: 'b1', orgId: 'o1', panels: [] };

function setup() {
  const accounts: Array<{ id: string; brandId: string; username: string; passwordHash: string }> = [];
  const subs: Array<{ accountId: string; subId: string; urlEnc: string; createdAt: Date }> = [];
  const sessions: Array<{ id: string; accountId: string; tokenHash: string; lastUsedAt: Date }> = [];
  const prisma = {
    customerAccount: {
      findUnique: vi.fn(async ({ where }: { where: { brandId_username: { brandId: string; username: string } } }) =>
        accounts.find((a) => a.brandId === where.brandId_username.brandId && a.username === where.brandId_username.username) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: { brandId: string; username: string; passwordHash: string } }) => {
        const a = { id: `a${accounts.length + 1}`, ...data };
        accounts.push(a);
        return a;
      }),
    },
    customerSub: {
      count: vi.fn(async ({ where }: { where: { accountId: string } }) => subs.filter((s) => s.accountId === where.accountId).length),
      upsert: vi.fn(async ({ create }: { create: { accountId: string; subId: string; urlEnc: string } }) => {
        subs.push({ ...create, createdAt: new Date() });
      }),
      findMany: vi.fn(async ({ where }: { where: { accountId: string } }) => subs.filter((s) => s.accountId === where.accountId)),
    },
    customerSession: {
      create: vi.fn(async ({ data }: { data: { accountId: string; tokenHash: string } }) => {
        sessions.push({ id: `s${sessions.length + 1}`, lastUsedAt: new Date(), ...data });
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const s = sessions.find((x) => x.tokenHash === where.tokenHash);
        return s ? { ...s, account: accounts.find((a) => a.id === s.accountId)! } : null;
      }),
    },
  };
  const config = { getOrThrow: () => KEY } as never;
  const brands = { resolve: vi.fn(async () => brand) } as never;
  // Only links containing "good" resolve on the brand's panels.
  const lookup = {
    lookup: vi.fn(async (_b: unknown, url: string) => {
      if (!url.includes('good')) throw new Error('not found');
      return { subId: url.split('/').pop(), snapshot: { subscriptionId: 'x' } };
    }),
  } as never;
  return { svc: new CustomersService(prisma as never, config, brands, lookup), accounts, subs };
}

describe('customer logins', () => {
  it('signs up with the device links that really resolve, then signs in elsewhere and gets them', async () => {
    const { svc } = setup();
    const made = await svc.register({
      username: 'Ali.R',
      password: 'secret1',
      accounts: [
        { subId: 's1', url: 'https://p.example.com/sub/good1' },
        { subId: 's2', url: 'https://p.example.com/sub/bad2' },
      ],
    });
    expect(made.username).toBe('ali.r');
    expect(made.token).toBeTruthy();
    expect(made.subscriptions).toEqual([{ subId: 'good1', url: 'https://p.example.com/sub/good1' }]);

    const again = await svc.login({ username: 'ALI.r', password: 'secret1' });
    expect(again.subscriptions.map((s) => s.url)).toEqual(['https://p.example.com/sub/good1']);
    await expect(svc.login({ username: 'ali.r', password: 'wrong' })).rejects.toThrow(/Wrong username or password/);
    await expect(svc.login({ username: 'nobody', password: 'secret1' })).rejects.toThrow(/Wrong username or password/);
  });

  it('refuses bad usernames, short passwords, taken names and accounts with no valid link', async () => {
    const { svc } = setup();
    const good = [{ subId: 's', url: 'https://p.example.com/sub/good9' }];
    await expect(svc.register({ username: 'a', password: 'secret1', accounts: good })).rejects.toThrow(/Username/);
    await expect(svc.register({ username: 'ali', password: '123', accounts: good })).rejects.toThrow(/Password/);
    await expect(svc.register({ username: 'ali', password: 'secret1', accounts: [] })).rejects.toThrow(/subscription/);
    await svc.register({ username: 'ali', password: 'secret1', accounts: good });
    await expect(svc.register({ username: 'Ali', password: 'secret1', accounts: good })).rejects.toThrow(/taken/);
  });

  it('gives a buyer without a login one with a starting password, and the delivered service joins it', async () => {
    const { svc } = setup();
    const buyer = await svc.forPurchase(brand as never, undefined, 'Reza Ahmadi');
    expect(buyer.credentials?.username).toMatch(/^rezaahmadi\d{4,5}$/);
    expect(buyer.credentials?.password).toHaveLength(8);
    await svc.attach(buyer.id, 'newsub', 'https://p.example.com/s/newsub');
    const view = await svc.login({ username: buyer.credentials!.username, password: buyer.credentials!.password });
    expect(view.subscriptions).toEqual([{ subId: 'newsub', url: 'https://p.example.com/s/newsub' }]);

    // Signed in already: the purchase uses that login and makes no new one.
    const same = await svc.forPurchase(brand as never, buyer.credentials!.token, null);
    expect(same).toEqual({ id: buyer.id, credentials: null });
  });

  it('makes readable passwords and clean usernames', () => {
    expect(generatePassword()).toMatch(/^[a-hj-km-np-z2-9]{8}$/);
    expect(cleanUsername('  Ali_99 ')).toBe('ali_99');
  });
});
