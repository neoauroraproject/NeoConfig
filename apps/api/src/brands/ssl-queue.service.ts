import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { join } from 'path';

export interface SslResult {
  ok: boolean;
  message: string;
  at: string;
  expires?: string | null;
}

/**
 * Hands certificate work to the host without giving the API root.
 * The API drops `<domain>.issue` / `<domain>.remove` files into
 * NEOCONFIG_SSL_QUEUE; a root systemd path unit (`neoconfig ssl-process`)
 * re-checks each domain with /api/v1/public/domain-check, runs acme.sh,
 * writes the nginx vhost and leaves `<domain>.result` for us to read.
 * Without NEOCONFIG_SSL_QUEUE (local dev) the queue is simply off.
 */
@Injectable()
export class SslQueueService {
  private readonly logger = new Logger(SslQueueService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.dir);
  }

  private get dir() {
    return this.config.get<string>('NEOCONFIG_SSL_QUEUE')?.trim() || '';
  }

  async request(domain: string, action: 'issue' | 'remove') {
    if (!this.enabled || !isSafeDomain(domain)) return false;
    try {
      await mkdir(this.dir, { recursive: true });
      if (action === 'issue') await rm(join(this.dir, `${domain}.result`), { force: true });
      await writeFile(join(this.dir, `${domain}.${action}`), new Date().toISOString());
      return true;
    } catch (err) {
      this.logger.warn(`Could not queue ${action} for ${domain}: ${(err as Error).message}`);
      return false;
    }
  }

  async isPending(domain: string) {
    if (!this.enabled || !isSafeDomain(domain)) return false;
    return stat(join(this.dir, `${domain}.issue`)).then(
      () => true,
      () => false,
    );
  }

  async result(domain: string): Promise<SslResult | null> {
    if (!this.enabled || !isSafeDomain(domain)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir, `${domain}.result`), 'utf8')) as SslResult;
    } catch {
      return null;
    }
  }
}

/** Same rule the host script enforces; never lets a path segment through. */
export function isSafeDomain(domain: string) {
  return /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain);
}
