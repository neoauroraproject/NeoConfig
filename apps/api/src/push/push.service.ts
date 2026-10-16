import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { encryptSecret } from '../common/crypto/secret.crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Web Push with VAPID. Keys come from env, or are generated once and kept in
 * AppSetting so existing device subscriptions survive restarts.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private publicKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    let pub = this.config.get<string>('VAPID_PUBLIC_KEY');
    let priv = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (!pub || !priv) {
      const stored = await this.prisma.appSetting.findUnique({ where: { key: 'vapid' } });
      if (stored) {
        ({ publicKey: pub, privateKey: priv } = JSON.parse(stored.value) as { publicKey: string; privateKey: string });
      } else {
        const keys = webpush.generateVAPIDKeys();
        pub = keys.publicKey;
        priv = keys.privateKey;
        await this.prisma.appSetting.create({ data: { key: 'vapid', value: JSON.stringify(keys) } });
      }
    }
    const subject =
      this.config.get<string>('VAPID_SUBJECT') ||
      `mailto:${this.config.get<string>('BOOTSTRAP_ADMIN_EMAIL') || 'admin@example.com'}`;
    webpush.setVapidDetails(subject, pub!, priv!);
    this.publicKey = pub!;
  }

  getPublicKey() {
    return this.publicKey;
  }

  async register(input: {
    brandId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    subIds: string[];
    accounts: Array<{ subId: string; url: string }>;
  }) {
    const accounts = dedupeBy(
      input.accounts.filter((a) => a.subId && a.url).map((a) => ({ subId: a.subId.slice(0, 128), url: a.url })),
      (a) => a.subId,
    ).slice(0, 20);
    const ids = [...new Set([...accounts.map((a) => a.subId), ...input.subIds.filter(Boolean).map((s) => s.slice(0, 128))])];
    const subIds = ids.slice(0, 20).join(',');
    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    await this.prisma.$transaction(async (tx) => {
      const device = await tx.pushDevice.upsert({
        where: { endpoint: input.endpoint },
        create: { brandId: input.brandId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth, subIds },
        update: { brandId: input.brandId, p256dh: input.p256dh, auth: input.auth, subIds },
      });
      await tx.pushFollow.deleteMany({
        where: { deviceId: device.id, subId: { notIn: accounts.map((a) => a.subId) } },
      });
      for (const a of accounts) {
        const urlEnc = encryptSecret(a.url, key);
        await tx.pushFollow.upsert({
          where: { deviceId_subId: { deviceId: device.id, subId: a.subId } },
          create: { deviceId: device.id, subId: a.subId, urlEnc },
          update: { urlEnc },
        });
      }
    });
    return { ok: true };
  }

  async unregister(endpoint: string) {
    await this.prisma.pushDevice.deleteMany({ where: { endpoint } });
    return { ok: true };
  }

  /** Notify the device that filed a request plus every device following that subscription. */
  async notifySubscription(brandId: string, subId: string, payload: PushPayload, extraEndpoint?: string | null) {
    const devices = await this.prisma.pushDevice.findMany({
      where: {
        brandId,
        OR: [
          { subIds: { contains: subId } },
          ...(extraEndpoint ? [{ endpoint: extraEndpoint }] : []),
        ],
      },
    });
    const targets = devices.filter(
      (d) => d.endpoint === extraEndpoint || d.subIds.split(',').includes(subId),
    );
    return this.sendMany(targets, payload);
  }

  async broadcast(brandId: string, payload: PushPayload) {
    const devices = await this.prisma.pushDevice.findMany({ where: { brandId } });
    return this.sendMany(devices, payload);
  }

  private async sendMany(
    devices: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>,
    payload: PushPayload,
  ) {
    let sent = 0;
    const body = JSON.stringify(payload);
    await Promise.all(
      devices.map(async (d) => {
        try {
          await webpush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            body,
            { TTL: 60 * 60 * 24 },
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushDevice.delete({ where: { id: d.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Push failed (${status ?? 'network'}): ${(err as Error).message}`);
          }
        }
      }),
    );
    return { sent, total: devices.length };
  }
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
