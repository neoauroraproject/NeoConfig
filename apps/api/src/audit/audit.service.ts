import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: {
    orgId?: string | null;
    userId?: string | null;
    action: string;
    resource?: string;
    resourceId?: string;
    ip?: string;
    meta?: Record<string, unknown>;
  }) {
    await this.prisma.auditLog.create({
      data: {
        orgId: input.orgId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        ip: input.ip,
        metaJson: input.meta ? JSON.stringify(input.meta) : null,
      },
    });
  }
}
