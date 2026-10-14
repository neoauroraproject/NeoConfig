import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Optional HMPanel renewal adapter.
 * No verified public renewal API was found in this repository.
 * Exposes an explicit unconfigured state — does not invent endpoints.
 */
@Injectable()
export class HmPanelService {
  constructor(private readonly prisma: PrismaService) {}

  async status(user: AuthUser) {
    this.requireOrg(user);
    const row = await this.prisma.hmPanelConnection.findUnique({
      where: { orgId: user.orgId! },
    });
    return {
      configured: row?.configured ?? false,
      baseUrl: row?.baseUrl ?? null,
      lastTestAt: row?.lastTestAt?.toISOString() ?? null,
      lastTestOk: row?.lastTestOk ?? null,
      lastTestMessage:
        row?.lastTestMessage ??
        'HMPanel renewal API is not configured. Adapter interface is ready; live renewal is disabled until a verified contract is provided.',
      capabilities: {
        lookup: false,
        renewal: false,
        eligibility: false,
      },
    };
  }

  async renewalAvailable(_user: AuthUser, _subscriptionId: string) {
    return {
      available: false,
      reason: 'HMPanel renewal is unconfigured',
    };
  }

  private requireOrg(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('No organization');
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }
}
