import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, ServerStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { hashToken } from '../common/crypto/secret.crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    this.requireOrgAdmin(user);
    const rows = await this.prisma.server.findMany({
      where: { orgId: user.orgId! },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      agentVersion: r.agentVersion,
      status: r.status,
      lastHeartbeatAt: r.lastHeartbeatAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      revokedAt: r.revokedAt?.toISOString() ?? null,
    }));
  }

  async create(user: AuthUser, name: string) {
    this.requireOrgAdmin(user);
    const server = await this.prisma.server.create({
      data: {
        orgId: user.orgId!,
        name,
        status: ServerStatus.PENDING,
      },
    });

    const token = randomBytes(24).toString('base64url');
    const ttl = Number(this.config.get('AGENT_ENROLLMENT_TTL_MINUTES') || 30);
    await this.prisma.enrollmentToken.create({
      data: {
        orgId: user.orgId!,
        serverId: server.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttl * 60_000),
      },
    });

    const appUrl = (this.config.get('APP_URL') || 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
    const installCommand = `curl -fsSL ${appUrl}/install.sh -o /tmp/neoconfig-install.sh && sudo bash /tmp/neoconfig-install.sh --token '${token}'`;

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'server.create',
      resource: 'server',
      resourceId: server.id,
    });

    return {
      server: {
        id: server.id,
        name: server.name,
        status: server.status,
      },
      enrollmentToken: token,
      expiresInMinutes: ttl,
      installCommand,
      warning:
        'This enrollment token is single-use and short-lived. Never put panel admin credentials in the install command.',
    };
  }

  async revoke(user: AuthUser, serverId: string) {
    this.requireOrgAdmin(user);
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, orgId: user.orgId! },
    });
    if (!server) throw new NotFoundException('Server not found');

    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status: ServerStatus.REVOKED,
        revokedAt: new Date(),
        credentialHash: null,
      },
    });
    await this.prisma.enrollmentToken.updateMany({
      where: { serverId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'server.revoke',
      resource: 'server',
      resourceId: serverId,
    });

    return { ok: true };
  }

  async enroll(token: string, meta: { hostname?: string; agentVersion?: string }) {
    const tokenHash = hashToken(token);
    const enrollment = await this.prisma.enrollmentToken.findUnique({
      where: { tokenHash },
      include: { server: true },
    });
    if (!enrollment || enrollment.revokedAt || enrollment.usedAt) {
      throw new UnauthorizedException('Invalid enrollment token');
    }
    if (enrollment.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Enrollment token expired');
    }
    if (enrollment.server.status === ServerStatus.REVOKED) {
      throw new UnauthorizedException('Server revoked');
    }

    const agentSecret = randomBytes(32).toString('base64url');
    const credentialHash = createHash('sha256').update(agentSecret).digest('hex');

    await this.prisma.$transaction([
      this.prisma.enrollmentToken.update({
        where: { id: enrollment.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.server.update({
        where: { id: enrollment.serverId },
        data: {
          status: ServerStatus.ONLINE,
          hostname: meta.hostname,
          agentVersion: meta.agentVersion,
          credentialHash,
          lastHeartbeatAt: new Date(),
        },
      }),
    ]);

    await this.audit.log({
      orgId: enrollment.orgId,
      action: 'server.enroll',
      resource: 'server',
      resourceId: enrollment.serverId,
      meta: { hostname: meta.hostname },
    });

    const apiUrl = (this.config.get('API_URL') || 'http://localhost:4000').replace(
      /\/+$/,
      '',
    );

    return {
      serverId: enrollment.serverId,
      agentSecret,
      apiBaseUrl: `${apiUrl}/api/v1/agent`,
      heartbeatIntervalSeconds: 60,
    };
  }

  async heartbeat(
    serverId: string,
    agentSecret: string,
    body: { agentVersion?: string; hostname?: string },
  ) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server || server.status === ServerStatus.REVOKED || !server.credentialHash) {
      throw new UnauthorizedException('Invalid agent credentials');
    }
    const hash = createHash('sha256').update(agentSecret).digest('hex');
    if (hash !== server.credentialHash) {
      throw new UnauthorizedException('Invalid agent credentials');
    }

    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status: ServerStatus.ONLINE,
        lastHeartbeatAt: new Date(),
        agentVersion: body.agentVersion ?? server.agentVersion,
        hostname: body.hostname ?? server.hostname,
      },
    });

    return { ok: true };
  }

  private requireOrgAdmin(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('No organization');
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }
}
