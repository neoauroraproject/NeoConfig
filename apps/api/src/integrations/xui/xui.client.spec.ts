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
