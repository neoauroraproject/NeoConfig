import { describe, expect, it, vi } from 'vitest';
import { XuiClientService } from './xui.client';

describe('XuiClientService.fetchSubscriptionInfo', () => {
  it('parses format=info JSON and subscription-userinfo headers from docs contract', async () => {
    const svc = new XuiClientService();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('format=info');
      return new Response(
        JSON.stringify({
          email: 'user1',
          enable: true,
          up: 1048576,
          down: 2097152,
          total: 10737418240,
          expiryTime: 1893456000000,
          subId: 'i7tvdpeffi0hvvf1',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'subscription-userinfo':
              'upload=1048576; download=2097152; total=10737418240; expire=1893456000',
          },
        },
      );
    }) as unknown as typeof fetch;

    const result = await svc.fetchSubscriptionInfo(
      'https://sub.example.com/sub/i7tvdpeffi0hvvf1',
      { fetchImpl },
    );

    expect(result.reachable).toBe(true);
    expect(result.info?.email).toBe('user1');
    expect(result.userInfo?.total).toBe(10737418240);
  });

  it('rejects redirect responses', async () => {
    const svc = new XuiClientService();
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/meta' },
      }),
    ) as unknown as typeof fetch;

    await expect(
      svc.fetchSubscriptionInfo('https://sub.example.com/sub/abc', { fetchImpl }),
    ).rejects.toThrow(/Redirects/);
  });
});

describe('XuiClientService on 3x-ui 3.x (clients outside inbounds)', () => {
  const cfg = { baseUrl: 'https://p.example.com/base', apiToken: 'tok' };
  const GB = 1024 ** 3;
  const row = {
    id: 1,
    email: 'ali',
    subId: 'pZSfex',
    totalGB: 50 * GB,
    expiryTime: Date.now() + 5 * 86_400_000,
    enable: true,
    limitIp: 1,
    inboundIds: [3, 5],
    traffic: { up: GB, down: 9 * GB, enable: true },
  };

  function panel() {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const json = (obj: unknown) => new Response(JSON.stringify({ success: true, obj }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/inbounds/list')) return json([{ id: 3, protocol: 'vless', settings: '{"clients":[]}' }]);
        if (url.endsWith('/clients/list')) return json([row]);
        if (url.includes('/clients/onlines')) return json(['ali']);
        if (url.includes('/clients/traffic/')) return json({ lastOnline: 1_700_000_000_000 });
        if (url.includes('/clients/get/')) return json({ ...row, tgId: 42 });
        return json(null);
      }),
    );
    return calls;
  }

  it('counts and finds clients through clients/list', async () => {
    panel();
    const svc = new XuiClientService();
    expect(await svc.stats(cfg)).toEqual({ clients: 1, online: 1 });
    const found = await svc.findBySubId(cfg, 'pZSfex');
    expect(found?.snapshot.totalUsedBytes).toBe(10 * GB);
    expect(found?.snapshot.remainingBytes).toBe(40 * GB);
    expect(found?.online).toBe(true);
    expect(found?.renewable).toBe(true);
    vi.unstubAllGlobals();
  });

  it('renews with the full client record via clients/update', async () => {
    const calls = panel();
    const res = await new XuiClientService().renewBySubId(cfg, 'pZSfex', { days: 30, gb: 20, users: 2, mode: 'add' });
    expect(res.ok).toBe(true);
    const update = calls.find((c) => c.url.includes('/clients/update/ali'));
    expect(update?.body).toMatchObject({ email: 'ali', tgId: 42, inboundIds: [3, 5], totalGB: 70 * GB, limitIp: 2, enable: true });
    expect(update?.body).not.toHaveProperty('traffic');
    expect(calls.some((c) => c.url.includes('resetTraffic'))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('remarkFromBody', () => {
  it('reads the first config name from base64, plain and JSON subscriptions', async () => {
    const { remarkFromBody } = await import('./xui.client');
    const plain = 'vless://uuid@host:443?type=tcp#Asiatech-%D8%B9%D9%84%DB%8C\ntrojan://x@h:1#Other';
    expect(remarkFromBody(plain)).toBe('Asiatech-علی');
    expect(remarkFromBody(Buffer.from(plain).toString('base64'))).toBe('Asiatech-علی');
    expect(remarkFromBody(JSON.stringify([{ remarks: 'DE ali-01', outbounds: [] }]))).toBe('DE ali-01');
    expect(remarkFromBody('<html>nope</html>')).toBeNull();
  });
});

describe('3x-ui 3.7+ HWID device limit', () => {
  it('reports registered devices and renews the HWID limit', async () => {
    const GB = 1024 ** 3;
    const row = { email: 'sara', subId: 'hw1', totalGB: 0, expiryTime: 0, enable: true, limitIp: 0, limitHwid: 2, traffic: { up: 0, down: GB } };
    const calls: Array<{ url: string; body?: unknown }> = [];
    const json = (obj: unknown) => new Response(JSON.stringify({ success: true, obj }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (url.endsWith('/inbounds/list')) return json([]);
        if (url.endsWith('/clients/list')) return json([row]);
        if (url.includes('/clients/hwids/')) return json([{ id: 1, deviceOs: 'android' }]);
        if (url.includes('/clients/get/')) return json(row);
        return json([]);
      }),
    );
    const svc = new XuiClientService();
    const cfg = { baseUrl: 'https://p.example.com', apiToken: 't' };
    const found = await svc.findBySubId(cfg, 'hw1');
    expect(found).toMatchObject({ deviceMode: 'hwid', deviceLimit: 2, devicesRegistered: 1 });
    await svc.renewBySubId(cfg, 'hw1', { days: 30, gb: 0, users: 3, mode: 'add' });
    const update = calls.find((c) => c.url.includes('/clients/update/sara'));
    expect(update?.body).toMatchObject({ limitHwid: 3, limitIp: 0 });
    vi.unstubAllGlobals();
  });
});
