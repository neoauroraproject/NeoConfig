import { describe, expect, it } from 'vitest';
import { cleanNetworkStatus } from './network-status.service';

describe('cleanNetworkStatus', () => {
  it('keeps what the app shows and nothing else', () => {
    const s = cleanNetworkStatus({
      overall: 'operational',
      updatedAt: 1791650000000,
      secret: 'x',
      groups: [
        {
          name: 'Tunnels',
          monitors: [
            { name: 'DE2', country: 'de', status: 'up', latencyMs: 92, uptime24h: 0.9995, uptime30d: 0.9981, history: ['u', 'u', 'd', 'u'], target: '10.0.0.1' },
            { name: 'X', country: 'germany', status: 'weird', history: 'nope' },
          ],
        },
      ],
      incidents: [{ title: 'DE slow', message: 'Investigating', status: 'investigating', startedAt: '2026-10-27T10:00:00Z' }],
      maintenance: [],
    });
    expect(s.overall).toBe('operational');
    expect(s.groups[0].monitors[0]).toEqual({
      name: 'DE2', country: 'de', status: 'up', latencyMs: 92, uptime24h: 0.9995, uptime30d: 0.9981, history: ['u', 'u', 'd', 'u'],
    });
    expect(s.groups[0].monitors[1]).toMatchObject({ country: null, status: 'unknown', history: [], latencyMs: null });
    expect(s.incidents[0]).toMatchObject({ title: 'DE slow', message: 'Investigating', status: 'investigating' });
    expect(JSON.stringify(s)).not.toContain('10.0.0.1');
  });
});
