import { mkdtemp, readdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { isSafeDomain, SslQueueService } from './ssl-queue.service';

const queue = (dir?: string) => new SslQueueService({ get: () => dir } as never);

describe('SslQueueService', () => {
  it('writes requests and reads results from the queue folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ncssl-'));
    const q = queue(dir);
    expect(await q.request('shop.example.com', 'issue')).toBe(true);
    expect(await q.isPending('shop.example.com')).toBe(true);
    expect(await readdir(dir)).toContain('shop.example.com.issue');

    await writeFile(join(dir, 'shop.example.com.result'), JSON.stringify({ ok: true, message: 'Certificate valid until 2027-01-15', at: 'now' }));
    expect((await q.result('shop.example.com'))?.ok).toBe(true);
  });

  it('is off without NEOCONFIG_SSL_QUEUE', async () => {
    const q = queue(undefined);
    expect(q.enabled).toBe(false);
    expect(await q.request('shop.example.com', 'issue')).toBe(false);
  });

  it('never lets a crafted name become a path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ncssl-'));
    const q = queue(dir);
    for (const bad of ['../etc/passwd', 'a/b.com', 'evil.com\n', '-x.com', 'UPPER.com', 'x']) {
      expect(isSafeDomain(bad)).toBe(false);
      expect(await q.request(bad, 'issue')).toBe(false);
    }
    expect(await readdir(dir)).toEqual([]);
  });
});
