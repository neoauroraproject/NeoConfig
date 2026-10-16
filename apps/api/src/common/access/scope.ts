import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../../auth/auth.types';

export function isOrgAdmin(user: AuthUser) {
  return user.role === Role.ORG_ADMIN || user.role === Role.SUPER_ADMIN;
}

export function requireOrg(user: AuthUser): string {
  if (!user.orgId) throw new ForbiddenException('No organization');
  if (!isOrgAdmin(user) && user.role !== Role.RESELLER) {
    throw new ForbiddenException('Admin only');
  }
  return user.orgId;
}

export function requireOrgAdmin(user: AuthUser): string {
  const orgId = requireOrg(user);
  if (!isOrgAdmin(user)) throw new ForbiddenException('Owner or admin only');
  return orgId;
}

/** Prisma `where` for brands this user may manage: admins see the org, resellers their own. */
export function brandScope(user: AuthUser) {
  const orgId = requireOrg(user);
  return isOrgAdmin(user) ? { orgId } : { orgId, ownerId: user.id };
}
