import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrandsService } from '../brands/brands.service';
import { decryptSecret } from '../common/crypto/secret.crypto';
import { NetworkStatus, fetchNeoUptime } from '../common/neo-uptime';

export { cleanNetworkStatus } from '../common/neo-uptime';
export type { NetworkMonitor, NetworkNotice, NetworkStatus } from '../common/neo-uptime';

/**
 * The brand's NeoUptime status page, fetched by the server (the API key never
 * reaches the browser) and cached for a minute.
 */
@Injectable()
export class NetworkStatusService {
  private readonly logger = new Logger(NetworkStatusService.name);
  private cache = new Map<string, { at: number; data: NetworkStatus }>();

  constructor(
    private readonly brands: BrandsService,
    private readonly config: ConfigService,
  ) {}

  async forTenant(tenant?: string): Promise<NetworkStatus | { enabled: false }> {
    const brand = await this.brands.resolve(tenant);
    if (!brand) throw new NotFoundException('No storefront is configured yet');
    if (!brand.uptimeUrl || !brand.uptimeSlug) return { enabled: false };
    const hit = this.cache.get(brand.id);
    if (hit && Date.now() - hit.at < 60_000) return hit.data;
    try {
      const key = brand.uptimeKeyEnc ? decryptSecret(brand.uptimeKeyEnc, this.config.getOrThrow<string>('ENCRYPTION_KEY')) : null;
      const data = await fetchNeoUptime(brand.uptimeUrl, brand.uptimeSlug, key);
      this.cache.set(brand.id, { at: Date.now(), data });
      return data;
    } catch (err) {
      this.logger.warn(`Network status for ${brand.slug} failed: ${err instanceof Error ? err.message : err}`);
      if (hit) return { ...hit.data, stale: true };
      return { enabled: true, overall: 'unknown', updatedAt: null, groups: [], incidents: [], maintenance: [], stale: true };
    }
  }
}
