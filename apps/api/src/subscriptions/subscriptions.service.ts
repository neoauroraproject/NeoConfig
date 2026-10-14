import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExpiryKind,
  QuotaKind,
  SubscriptionStatus,
  SyncState,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import {
  decryptSecret,
  encryptSecret,
  fingerprint,
  redactUrl,
} from '../common/crypto/secret.crypto';
import { assertPublicHttpUrl, resolveAndAssertPublic, SsrfError } from '../common/ssrf/ssrf.guard';
import {
  normalizeFromClientTraffic,
  normalizeFromSubInfo,
  normalizeFromUserInfoHeaders,
  unknownSnapshot,
} from '../integrations/xui/normalize';
import { NormalizedSubscription } from '../integrations/xui/types';
import { XuiClientService } from '../integrations/xui/xui.client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly xui: XuiClientService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const rows = await this.prisma.subscription.findMany({
      where: { userId: user.id },
      include: { snapshot: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(user: AuthUser, id: string) {
    const row = await this.prisma.subscription.findFirst({
      where: { id, userId: user.id },
      include: { snapshot: true },
    });
    if (!row) throw new NotFoundException('Subscription not found');
    return this.toDto(row);
  }

  async preview(user: AuthUser, url: string) {
    const normalized = await this.fetchNormalized(url, user);
    return {
      preview: normalized,
      redactedUrl: redactUrl(url),
    };
  }

  async create(
    user: AuthUser,
    input: { url: string; displayName?: string; color?: string },
  ) {
    await this.validateUrl(input.url);
    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const urlEnc = encryptSecret(input.url, key);
    const urlFingerprint = fingerprint(input.url);
    const subIdHint = extractSubId(input.url);

    const created = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        orgId: user.orgId,
        displayName: input.displayName || subIdHint || 'My subscription',
        color: input.color,
        urlEnc,
        urlFingerprint,
        subIdHint,
        snapshot: {
          create: {
            status: SubscriptionStatus.UNKNOWN,
            quotaKind: QuotaKind.UNKNOWN,
            expiryKind: ExpiryKind.UNKNOWN,
            syncState: SyncState.NEVER,
            dataSource: 'unknown',
          },
        },
      },
      include: { snapshot: true },
    });

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'subscription.create',
      resource: 'subscription',
      resourceId: created.id,
      meta: { redactedUrl: redactUrl(input.url) },
    });

    try {
      return await this.refresh(user, created.id);
    } catch {
      return this.toDto(created);
    }
  }

  async refresh(user: AuthUser, id: string) {
    const row = await this.prisma.subscription.findFirst({
      where: { id, userId: user.id },
      include: { snapshot: true },
    });
    if (!row) throw new NotFoundException('Subscription not found');

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const url = decryptSecret(row.urlEnc, key);

    try {
      const normalized = await this.fetchNormalized(url, user, row.subIdHint);
      await this.prisma.subscriptionSnapshot.upsert({
        where: { subscriptionId: row.id },
        create: this.snapshotData(row.id, normalized),
        update: this.snapshotData(row.id, normalized),
      });
      const updated = await this.prisma.subscription.findUniqueOrThrow({
        where: { id: row.id },
        include: { snapshot: true },
      });
      return this.toDto(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed';
      if (row.snapshot) {
        await this.prisma.subscriptionSnapshot.update({
          where: { subscriptionId: row.id },
          data: {
            syncState: SyncState.FAILED,
            lastSyncError: message.slice(0, 500),
          },
        });
      }
      const updated = await this.prisma.subscription.findUniqueOrThrow({
        where: { id: row.id },
        include: { snapshot: true },
      });
      const dto = this.toDto(updated);
      return { ...dto, refreshError: message };
    }
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.prisma.subscription.findFirst({
      where: { id, userId: user.id },
    });
    if (!row) throw new NotFoundException('Subscription not found');
    await this.prisma.subscription.delete({ where: { id } });
    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'subscription.delete',
      resource: 'subscription',
      resourceId: id,
    });
    return { ok: true };
  }

  async updateMeta(
    user: AuthUser,
    id: string,
    input: { displayName?: string; color?: string },
  ) {
    const row = await this.prisma.subscription.findFirst({
      where: { id, userId: user.id },
    });
    if (!row) throw new NotFoundException('Subscription not found');
    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        displayName: input.displayName ?? row.displayName,
        color: input.color ?? row.color,
      },
      include: { snapshot: true },
    });
    return this.toDto(updated);
  }

  private async fetchNormalized(
    url: string,
    user: AuthUser,
    subIdHint?: string | null,
  ): Promise<NormalizedSubscription> {
    await this.validateUrl(url);

    // Priority 1: registered panel admin API when org has a panel and we can match email/subId
    if (user.orgId) {
      const fromPanel = await this.tryPanelSync(user.orgId, url, subIdHint);
      if (fromPanel) return fromPanel;
    }

    // Priority 2: subscription endpoint ?format=info + headers
    try {
      const { info, userInfo, reachable } =
        await this.xui.fetchSubscriptionInfo(url);
      if (info) {
        return normalizeFromSubInfo(info, userInfo);
      }
      if (userInfo) {
        return normalizeFromUserInfoHeaders(userInfo, subIdHint ?? undefined);
      }
      if (!reachable) {
        return unknownSnapshot(
          subIdHint || 'unknown',
          subIdHint || 'Subscription',
          'Subscription endpoint unreachable',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      return unknownSnapshot(
        subIdHint || 'unknown',
        subIdHint || 'Subscription',
        message,
      );
    }

    return unknownSnapshot(
      subIdHint || 'unknown',
      subIdHint || 'Subscription',
      'Quota metadata unavailable for this link',
    );
  }

  private async tryPanelSync(
    orgId: string,
    url: string,
    subIdHint?: string | null,
  ): Promise<NormalizedSubscription | null> {
    const panels = await this.prisma.panelConnection.findMany({
      where: { orgId },
    });
    if (!panels.length) return null;

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const subId = subIdHint || extractSubId(url);
    if (!subId) return null;

    for (const panel of panels) {
      try {
        const creds = JSON.parse(decryptSecret(panel.credentialsEnc, key)) as {
          apiToken?: string;
          username?: string;
          password?: string;
        };
        const cfg = {
          baseUrl: panel.baseUrl,
          apiToken: creds.apiToken,
          username: creds.username,
          password: creds.password,
        };

        const clients = await this.xui.listClients(cfg);
        const match = (clients as Array<Record<string, unknown>>).find((c) => {
          const email = String(c.email ?? '');
          const sid = String(c.subId ?? '');
          return sid === subId || email === subId;
        });
        if (!match?.email) continue;

        const email = String(match.email);
        const traffic = await this.xui.getClientTraffic(cfg, email);
        if (traffic) {
          return normalizeFromClientTraffic(traffic, {
            displayName: String(match.comment || email),
            subscriptionId: subId,
          });
        }
      } catch {
        // try next panel
      }
    }
    return null;
  }

  private async validateUrl(url: string) {
    try {
      const parsed = assertPublicHttpUrl(url);
      await resolveAndAssertPublic(parsed);
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new ForbiddenException(err.message);
      }
      throw err;
    }
  }

  private snapshotData(subscriptionId: string, n: NormalizedSubscription) {
    return {
      subscriptionId,
      status: mapStatus(n.status),
      uploadBytes: n.uploadBytes !== null ? BigInt(n.uploadBytes) : null,
      downloadBytes: n.downloadBytes !== null ? BigInt(n.downloadBytes) : null,
      totalUsedBytes:
        n.totalUsedBytes !== null ? BigInt(n.totalUsedBytes) : null,
      quotaBytes: n.quotaBytes !== null ? BigInt(n.quotaBytes) : null,
      remainingBytes:
        n.remainingBytes !== null ? BigInt(n.remainingBytes) : null,
      quotaKind: mapQuota(n.quotaKind),
      expiryAt: n.expiryAt ? new Date(n.expiryAt) : null,
      expiryKind: mapExpiry(n.expiryKind),
      enabled: n.enabled,
      dataSource: n.dataSource,
      syncState: mapSync(n.syncState),
      lastSyncAt: n.lastSyncAt ? new Date(n.lastSyncAt) : new Date(),
      lastSyncError: n.lastSyncError,
    };
  }

  private toDto(row: {
    id: string;
    displayName: string;
    color: string | null;
    subIdHint: string | null;
    createdAt: Date;
    updatedAt: Date;
    snapshot: {
      status: SubscriptionStatus;
      uploadBytes: bigint | null;
      downloadBytes: bigint | null;
      totalUsedBytes: bigint | null;
      quotaBytes: bigint | null;
      remainingBytes: bigint | null;
      quotaKind: QuotaKind;
      expiryAt: Date | null;
      expiryKind: ExpiryKind;
      enabled: boolean | null;
      dataSource: string;
      syncState: SyncState;
      lastSyncAt: Date | null;
      lastSyncError: string | null;
    } | null;
  }) {
    const s = row.snapshot;
    return {
      id: row.id,
      displayName: row.displayName,
      color: row.color,
      subIdHint: row.subIdHint,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      snapshot: s
        ? {
            status: s.status.toLowerCase(),
            uploadBytes: bigToNum(s.uploadBytes),
            downloadBytes: bigToNum(s.downloadBytes),
            totalUsedBytes: bigToNum(s.totalUsedBytes),
            quotaBytes: bigToNum(s.quotaBytes),
            remainingBytes: bigToNum(s.remainingBytes),
            quotaKind: s.quotaKind.toLowerCase(),
            expiryAt: s.expiryAt?.toISOString() ?? null,
            expiryKind: s.expiryKind.toLowerCase(),
            enabled: s.enabled,
            dataSource: s.dataSource,
            syncState: s.syncState.toLowerCase(),
            lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
            lastSyncError: s.lastSyncError,
          }
        : null,
    };
  }
}

function extractSubId(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function bigToNum(v: bigint | null): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function mapStatus(s: string): SubscriptionStatus {
  const m: Record<string, SubscriptionStatus> = {
    active: SubscriptionStatus.ACTIVE,
    expiring_soon: SubscriptionStatus.EXPIRING_SOON,
    expired: SubscriptionStatus.EXPIRED,
    disabled: SubscriptionStatus.DISABLED,
    unknown: SubscriptionStatus.UNKNOWN,
  };
  return m[s] ?? SubscriptionStatus.UNKNOWN;
}

function mapQuota(s: string): QuotaKind {
  const m: Record<string, QuotaKind> = {
    known: QuotaKind.KNOWN,
    unlimited: QuotaKind.UNLIMITED,
    unknown: QuotaKind.UNKNOWN,
  };
  return m[s] ?? QuotaKind.UNKNOWN;
}

function mapExpiry(s: string): ExpiryKind {
  const m: Record<string, ExpiryKind> = {
    known: ExpiryKind.KNOWN,
    none: ExpiryKind.NONE,
    unknown: ExpiryKind.UNKNOWN,
  };
  return m[s] ?? ExpiryKind.UNKNOWN;
}

function mapSync(s: string): SyncState {
  const m: Record<string, SyncState> = {
    never: SyncState.NEVER,
    ok: SyncState.OK,
    stale: SyncState.STALE,
    failed: SyncState.FAILED,
  };
  return m[s] ?? SyncState.NEVER;
}
