import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role, ServerStatus, SyncState } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AuthUser) {
    if (!user.orgId && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('No organization');
    }
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }

    const orgFilter = user.role === Role.SUPER_ADMIN ? {} : { orgId: user.orgId! };

    const [
      orgCount,
      userCount,
      serverCount,
      onlineServers,
      panels,
      failedSyncs,
      recentAudits,
    ] = await Promise.all([
      user.role === Role.SUPER_ADMIN
        ? this.prisma.organization.count()
        : Promise.resolve(1),
      this.prisma.user.count({
        where: user.role === Role.SUPER_ADMIN ? {} : { orgId: user.orgId! },
      }),
      this.prisma.server.count({ where: orgFilter }),
      this.prisma.server.count({
        where: { ...orgFilter, status: ServerStatus.ONLINE },
      }),
      this.prisma.panelConnection.findMany({
        where: orgFilter,
        select: {
          id: true,
          name: true,
          lastTestOk: true,
          lastTestAt: true,
          lastTestMessage: true,
        },
      }),
      this.prisma.subscriptionSnapshot.count({
        where: {
          syncState: SyncState.FAILED,
          subscription: user.role === Role.SUPER_ADMIN ? {} : { orgId: user.orgId! },
        },
      }),
      this.prisma.auditLog.findMany({
        where: orgFilter,
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      organizations: orgCount,
      users: userCount,
      servers: serverCount,
      serversOnline: onlineServers,
      panels: panels.map((p) => ({
        id: p.id,
        name: p.name,
        healthy: p.lastTestOk,
        lastTestAt: p.lastTestAt?.toISOString() ?? null,
        message: p.lastTestMessage,
      })),
      failedSyncs,
      recentAudit: recentAudits.map((a) => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async audit(user: AuthUser) {
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }
    const rows = await this.prisma.auditLog.findMany({
      where: user.role === Role.SUPER_ADMIN ? {} : { orgId: user.orgId! },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((a) => ({
      id: a.id,
      action: a.action,
      resource: a.resource,
      resourceId: a.resourceId,
      createdAt: a.createdAt.toISOString(),
      metaJson: a.metaJson,
    }));
  }
}
