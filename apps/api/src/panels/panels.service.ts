import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { decryptSecret, encryptSecret } from '../common/crypto/secret.crypto';
import { assertPublicHttpUrl, resolveAndAssertPublic } from '../common/ssrf/ssrf.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PanelGatewayService, panelType } from './panel-gateway.service';

type PanelInput = {
  name: string;
  type?: string;
  baseUrl: string;
  apiToken?: string;
  username?: string;
  password?: string;
  subPathHint?: string;
};

@Injectable()
export class PanelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gateway: PanelGatewayService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    this.requireOrgAdmin(user);
    const rows = await this.prisma.panelConnection.findMany({
      where: { orgId: user.orgId! },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(user: AuthUser, input: PanelInput) {
    this.requireOrgAdmin(user);
    await this.assertReachableUrl(input.baseUrl);

    if (panelType(input.type) === 'hmpanel' && !input.apiToken?.startsWith('hmp_')) {
      throw new ForbiddenException('HMPanel needs an API key (hmp_…) from HMPanel → API access');
    }
    if (!input.apiToken && !(input.username && input.password)) {
      throw new ForbiddenException('Provide apiToken or username/password');
    }

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const credentialsEnc = encryptSecret(
      JSON.stringify({
        apiToken: input.apiToken,
        username: input.username,
        password: input.password,
      }),
      key,
    );

    const row = await this.prisma.panelConnection.create({
      data: {
        orgId: user.orgId!,
        name: input.name,
        type: panelType(input.type),
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        credentialsEnc,
        authMode: input.apiToken ? 'bearer' : 'cookie',
        subPathHint: input.subPathHint,
      },
    });

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'panel.create',
      resource: 'panel',
      resourceId: row.id,
    });

    return this.toDto(row);
  }

  async test(user: AuthUser, id: string) {
    this.requireOrgAdmin(user);
    const row = await this.prisma.panelConnection.findFirst({
      where: { id, orgId: user.orgId! },
    });
    if (!row) throw new NotFoundException('Panel not found');

    const result = await this.gateway.test(row);

    await this.prisma.panelConnection.update({
      where: { id },
      data: {
        lastTestAt: new Date(),
        lastTestOk: result.ok,
        lastTestMessage: result.message,
      },
    });

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'panel.test',
      resource: 'panel',
      resourceId: id,
      meta: { ok: result.ok },
    });

    return result;
  }

  async update(user: AuthUser, id: string, input: Partial<PanelInput>) {
    this.requireOrgAdmin(user);
    const row = await this.prisma.panelConnection.findFirst({
      where: { id, orgId: user.orgId! },
    });
    if (!row) throw new NotFoundException('Panel not found');
    if (input.baseUrl) await this.assertReachableUrl(input.baseUrl);

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    let credentialsEnc: string | undefined;
    if (input.apiToken || input.username || input.password) {
      const prev = JSON.parse(decryptSecret(row.credentialsEnc, key)) as Record<string, string | undefined>;
      const next = input.apiToken
        ? { apiToken: input.apiToken }
        : {
            username: input.username || prev.username,
            password: input.password || prev.password,
          };
      credentialsEnc = encryptSecret(JSON.stringify(next), key);
    }

    const updated = await this.prisma.panelConnection.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        type: input.type ? panelType(input.type) : undefined,
        baseUrl: input.baseUrl ? input.baseUrl.replace(/\/+$/, '') : undefined,
        subPathHint: input.subPathHint ?? undefined,
        credentialsEnc,
        authMode: credentialsEnc ? (input.apiToken ? 'bearer' : 'cookie') : undefined,
        lastTestOk: credentialsEnc || input.baseUrl ? null : undefined,
      },
    });
    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'panel.update',
      resource: 'panel',
      resourceId: id,
    });
    return this.toDto(updated);
  }

  /** Admins often run panels on a private network next to this app; opt in with ALLOW_PRIVATE_PANELS. */
  private async assertReachableUrl(raw: string) {
    try {
      const base = assertPublicHttpUrl(raw);
      await resolveAndAssertPublic(base);
    } catch (err) {
      if (this.config.get('ALLOW_PRIVATE_PANELS') === 'true') return;
      throw new ForbiddenException(
        `${err instanceof Error ? err.message : 'Invalid URL'} — set ALLOW_PRIVATE_PANELS=true to allow private panel addresses`,
      );
    }
  }

  async remove(user: AuthUser, id: string) {
    this.requireOrgAdmin(user);
    const row = await this.prisma.panelConnection.findFirst({
      where: { id, orgId: user.orgId! },
    });
    if (!row) throw new NotFoundException('Panel not found');
    await this.prisma.panelConnection.delete({ where: { id } });
    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'panel.delete',
      resource: 'panel',
      resourceId: id,
    });
    return { ok: true };
  }

  private requireOrgAdmin(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('No organization');
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  private toDto(row: {
    id: string;
    name: string;
    type: string;
    baseUrl: string;
    authMode: string;
    subPathHint: string | null;
    lastTestAt: Date | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      baseUrl: row.baseUrl,
      authMode: row.authMode,
      subPathHint: row.subPathHint,
      lastTestAt: row.lastTestAt?.toISOString() ?? null,
      lastTestOk: row.lastTestOk,
      lastTestMessage: row.lastTestMessage,
      createdAt: row.createdAt.toISOString(),
      credentialsConfigured: true,
    };
  }
}
