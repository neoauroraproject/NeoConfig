import { afterEach, describe, expect, it, vi } from 'vitest';
import { HmPanelClient, HmPanelClientService, normalizeHmPanelClient } from './hmpanel.client';

const GB = 1024 ** 3;

const client: HmPanelClient = {
  id: 'c1',
  email: 'ali-01',
  remark: 'Ali',
  subId: 'a1b2',
  subToken: 'tok123',
  enable: true,
  status: 'active',
  upBytes: GB,
  downBytes: 4 * GB,
  usedBytes: 5 * GB,
  totalBytes: 20 * GB,
  remainingBytes: 15 * GB,
  expiryTime: Date.now() + 10 * 86_400_000,
  lastSyncedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('HMPanel adapter', () => {
  it('normalizes usage, quota and expiry', () => {
    const n = normalizeHmPanelClient(client);
    expect(n.displayName).toBe('Ali');
    expect(n.remainingBytes).toBe(15 * GB);
    expect(n.quotaKind).toBe('known');
    expect(n.status).toBe('active');
    expect(normalizeHmPanelClient({ ...client, totalBytes: 0 }).quotaKind).toBe('unlimited');
    expect(normalizeHmPanelClient({ ...client, status: 'disabled', enable: false }).status).toBe('disabled');
  });

  it('looks up by key with the bearer API key and maps 404 to null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(client), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Client not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new HmPanelClientService();
    const cfg = { baseUrl: 'https://panel.example.com/', apiToken: 'hmp_test' };

    expect((await svc.lookup(cfg, 'tok123'))?.id).toBe('c1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://panel.example.com/api/v1/clients/lookup?key=tok123');
    expect(init.headers.Authorization).toBe('Bearer hmp_test');

    expect(await svc.lookup(cfg, 'missing')).toBeNull();
  });

  it('reset mode sets the new quota and zeroes usage', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(client), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await new HmPanelClientService().renew({ baseUrl: 'https://p.io', apiToken: 'hmp_x' }, 'c1', { days: 30, gb: 50, users: 0, mode: 'reset' });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://p.io/api/v1/clients/c1/renew');
    expect(JSON.parse(init.body)).toEqual({ days: 30, totalGb: 50, resetUsage: true });
  });

  it('add mode stacks data on the current quota and sets the user limit', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(client), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await new HmPanelClientService().renew({ baseUrl: 'https://p.io', apiToken: 'hmp_x' }, 'c1', { days: 30, gb: 10, users: 2, mode: 'add' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ days: 30, totalGb: 30, resetUsage: false });
    expect(fetchMock.mock.calls[2][0]).toBe('https://p.io/api/v1/clients/c1');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ limitIp: 2 });
    expect(r.ok).toBe(true);
  });
});
