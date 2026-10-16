import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RenewalStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { brandScope, isOrgAdmin, requireOrg, requireOrgAdmin } from '../common/access/scope';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;

/** YYYY-MM-DD in server local time (toISOString would shift east-of-UTC midnights back a day). */
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(user: AuthUser) {
    requireOrg(user);
    const scope = brandScope(user);
    const admin = isOrgAdmin(user);
    const since = new Date(Date.now() - 13 * DAY);
    since.setHours(0, 0, 0, 0);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [brands, panels, pending, approvedMonth, devices, lookups, recentRenewals] = await Promise.all([
      this.prisma.brand.findMany({
        where: scope,
        select: { id: true, appName: true, primaryColor: true, slug: true, active: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      admin
        ? this.prisma.panelConnection.findMany({
            where: { orgId: user.orgId! },
            select: { id: true, name: true, type: true, lastTestOk: true, lastTestAt: true, lastTestMessage: true },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      this.prisma.renewalRequest.count({ where: { brand: scope, status: RenewalStatus.PENDING } }),
      this.prisma.renewalRequest.count({
        where: { brand: scope, status: RenewalStatus.APPROVED, decidedAt: { gte: monthStart } },
      }),
      this.prisma.pushDevice.count({ where: { brand: scope } }),
      this.prisma.lookupEvent.findMany({
        where: { brand: scope, createdAt: { gte: since } },
        select: { createdAt: true, found: true },
      }),
      this.prisma.renewalRequest.findMany({
        where: { brand: scope },
        omit: { receiptData: true, subUrlEnc: true },
        include: { brand: { select: { appName: true, primaryColor: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const days: Array<{ date: string; found: number; missed: number }> = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since.getTime() + i * DAY);
      days.push({ date: localDate(d), found: 0, missed: 0 });
    }
    for (const l of lookups) {
      const idx = Math.floor((l.createdAt.getTime() - since.getTime()) / DAY);
      if (idx >= 0 && idx < 14) days[idx][l.found ? 'found' : 'missed'] += 1;
    }

    return {
      role: user.role,
      brands,
      panels: panels.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        healthy: p.lastTestOk,
        lastTestAt: p.lastTestAt?.toISOString() ?? null,
        message: p.lastTestMessage,
      })),
      pendingRenewals: pending,
      approvedThisMonth: approvedMonth,
      devices,
      lookups14d: days,
      lookupsTotal14d: lookups.length,
      recentRenewals: recentRenewals.map((r) => ({
        id: r.id,
        brand: r.brand,
        displayName: r.displayName,
        planTitle: r.planTitle,
        price: r.price,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async audit_(user: AuthUser) {
    const orgId = requireOrgAdmin(user);
    const rows = await this.prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { email: true } } },
    });
    return rows.map((a) => ({
      id: a.id,
      action: a.action,
      resource: a.resource,
      resourceId: a.resourceId,
      actor: a.user?.email ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  // ---------- team (resellers & admins) ----------

  async team(user: AuthUser) {
    const orgId = requireOrgAdmin(user);
    const rows = await this.prisma.user.findMany({
      where: { orgId, role: { in: [Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.RESELLER] } },
      include: { ownedBrands: { select: { id: true, appName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      brands: u.ownedBrands,
      createdAt: u.createdAt.toISOString(),
      isYou: u.id === user.id,
    }));
  }

  async createMember(
    user: AuthUser,
    input: { email: string; password: string; name?: string; role?: string; brandIds?: string[] },
  ) {
    const orgId = requireOrgAdmin(user);
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('This email already has an account');
    }
    const role = input.role === 'ORG_ADMIN' ? Role.ORG_ADMIN : Role.RESELLER;
    const member = await this.prisma.user.create({
      data: {
        email,
        name: input.name?.trim() || null,
        passwordHash: await bcrypt.hash(input.password, 12),
        role,
        orgId,
        locale: 'fa',
      },
    });
    if (input.brandIds?.length) {
      await this.prisma.brand.updateMany({
        where: { orgId, id: { in: input.brandIds } },
        data: { ownerId: member.id },
      });
    }
    await this.audit.log({ orgId, userId: user.id, action: 'team.create', resource: 'user', resourceId: member.id });
    return { ok: true, id: member.id };
  }

  async updateMember(
    user: AuthUser,
    id: string,
    input: { name?: string; password?: string; brandIds?: string[] },
  ) {
    const orgId = requireOrgAdmin(user);
    const member = await this.prisma.user.findFirst({ where: { id, orgId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === Role.SUPER_ADMIN && member.id !== user.id) {
      throw new ForbiddenException('The owner account can only be changed by the owner');
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        name: input.name !== undefined ? input.name.trim() || null : undefined,
        passwordHash: input.password ? await bcrypt.hash(input.password, 12) : undefined,
      },
    });
    if (input.brandIds) {
      await this.prisma.$transaction([
        this.prisma.brand.updateMany({
          where: { orgId, ownerId: id, id: { notIn: input.brandIds } },
          data: { ownerId: null },
        }),
        this.prisma.brand.updateMany({
          where: { orgId, id: { in: input.brandIds } },
          data: { ownerId: id },
        }),
      ]);
    }
    await this.audit.log({ orgId, userId: user.id, action: 'team.update', resource: 'user', resourceId: id });
    return { ok: true };
  }

  async removeMember(user: AuthUser, id: string) {
    const orgId = requireOrgAdmin(user);
    if (id === user.id) throw new BadRequestException('You cannot remove your own account');
    const member = await this.prisma.user.findFirst({ where: { id, orgId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === Role.SUPER_ADMIN) throw new ForbiddenException('The owner account cannot be removed');
    await this.prisma.user.delete({ where: { id } });
    await this.audit.log({ orgId, userId: user.id, action: 'team.delete', resource: 'user', resourceId: id });
    return { ok: true };
  }
}
