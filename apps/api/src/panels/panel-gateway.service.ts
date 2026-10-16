import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PanelConnection } from '@prisma/client';
import { decryptSecret } from '../common/crypto/secret.crypto';
import { HmPanelClientService, normalizeHmPanelClient } from '../integrations/hmpanel/hmpanel.client';
import { PasarGuardClientService } from '../integrations/pasarguard/pasarguard.client';
import { NormalizedSubscription } from '../integrations/xui/types';
import { XuiClientService } from '../integrations/xui/xui.client';

export type PanelType = 'xui' | 'pasarguard' | 'hmpanel';

export const PANEL_TYPES: PanelType[] = ['xui', 'pasarguard', 'hmpanel'];

export function panelType(raw?: string): PanelType {
  return PANEL_TYPES.includes(raw as PanelType) ? (raw as PanelType) : 'xui';
}

export interface FoundAccount {
  panelId: string;
  panelType: PanelType;
  /** subId on 3x-ui, username on PasarGuard — what renewals act on. */
  clientRef: string;
  displayName: string;
  snapshot: NormalizedSubscription;
  online: boolean | null;
  lastOnlineAt: string | null;
  renewable: boolean;
}

/** One entry point for every panel flavour, so callers never branch on type. */
@Injectable()
export class PanelGatewayService {
  private readonly logger = new Logger(PanelGatewayService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly xui: XuiClientService,
    private readonly pasarguard: PasarGuardClientService,
    private readonly hmpanel: HmPanelClientService,
  ) {}

  private creds(row: PanelConnection) {
    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const c = JSON.parse(decryptSecret(row.credentialsEnc, key)) as {
      apiToken?: string;
      username?: string;
      password?: string;
    };
    return { baseUrl: row.baseUrl, apiToken: c.apiToken || undefined, username: c.username, password: c.password };
  }

  async test(row: PanelConnection): Promise<{
    ok: boolean;
    message: string;
    stats?: { clients: number | null; online: number | null };
  }> {
    const cfg = this.creds(row);
    if (row.type === 'pasarguard') return this.pasarguard.testConnection(cfg);
    if (row.type === 'hmpanel') return this.hmpanel.testConnection(cfg);
    const result = await this.xui.testConnection(cfg);
    if (!result.ok) return result;
    const stats = await this.xui.stats(cfg).catch(() => undefined);
    return { ...result, stats };
  }

  async find(row: PanelConnection, subUrl: string, subId: string | null): Promise<FoundAccount | null> {
    const cfg = this.creds(row);
    try {
      if (row.type === 'hmpanel') {
        if (!subId) return null;
        const c = await this.hmpanel.lookup(cfg, subId);
        if (!c) return null;
        return {
          panelId: row.id,
          panelType: 'hmpanel',
          clientRef: c.id,
          displayName: c.remark || c.email,
          snapshot: normalizeHmPanelClient(c),
          online: null,
          lastOnlineAt: null,
          renewable: true,
        };
      }
      if (row.type === 'pasarguard') {
        const m = await this.pasarguard.findBySubscriptionUrl(cfg, subUrl);
        if (!m) return null;
        return {
          panelId: row.id,
          panelType: 'pasarguard',
          clientRef: m.username,
          displayName: m.username,
          snapshot: m.snapshot,
          online: m.online,
          lastOnlineAt: m.lastOnlineAt,
          renewable: true,
        };
      }
      if (!subId) return null;
      const m = await this.xui.findBySubId(cfg, subId);
      if (!m) return null;
      return {
        panelId: row.id,
        panelType: 'xui',
        clientRef: m.subId,
        displayName: m.displayName,
        snapshot: m.snapshot,
        online: m.online,
        lastOnlineAt: m.lastOnlineAt,
        renewable: m.renewable,
      };
    } catch (err) {
      this.logger.warn(`Lookup on panel ${row.name} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async renew(
    row: PanelConnection,
    clientRef: string,
    plan: { days: number; gb: number },
  ): Promise<{ ok: boolean; message: string }> {
    const cfg = this.creds(row);
    try {
      if (row.type === 'hmpanel') return await this.hmpanel.renew(cfg, clientRef, plan);
      return row.type === 'pasarguard'
        ? await this.pasarguard.renew(cfg, clientRef, plan)
        : await this.xui.renewBySubId(cfg, clientRef, plan);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Renewal failed' };
    }
  }
}
