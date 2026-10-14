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
import { XuiClientService } from '../integrations/xui/xui.client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PanelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly xui: XuiClientService,
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

  async create(
    user: AuthUser,
    input: {
      name: string;
      baseUrl: string;
      apiToken?: string;
      username?: string;
      password?: string;
      authMode?: string;
      subPathHint?: string;
    },
  ) {
    this.requireOrgAdmin(user);
    const base = assertPublicHttpUrl(input.baseUrl);
    await resolveAndAssertPublic(base);

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

    const key = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    const creds = JSON.parse(decryptSecret(row.credentialsEnc, key)) as {
      apiToken?: string;
      username?: string;
      password?: string;
    };

    const result = await this.xui.testConnection({
      baseUrl: row.baseUrl,
      apiToken: creds.apiToken,
      username: creds.username,
      password: creds.password,
    });

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
