import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPublic(slugOrDomain?: string) {
    let branding = null;
    if (slugOrDomain) {
      branding = await this.prisma.branding.findFirst({
        where: {
          OR: [
            { customDomain: slugOrDomain },
            { org: { slug: slugOrDomain } },
          ],
        },
      });
    }
    if (!branding) {
      branding = await this.prisma.branding.findFirst({
        orderBy: { orgId: 'asc' },
      });
    }
    return this.toPublic(branding);
  }

  async getForOrg(user: AuthUser) {
    this.requireOrg(user);
    const branding = await this.prisma.branding.findUnique({
      where: { orgId: user.orgId! },
    });
    return this.toPublic(branding);
  }

  async update(
    user: AuthUser,
    input: Partial<{
      appName: string;
      shortName: string;
      logoUrl: string;
      logoDarkUrl: string;
      iconUrl: string;
      faviconUrl: string;
      primaryColor: string;
      accentColor: string;
      themeDefault: string;
      fontFamily: string;
      defaultLocale: string;
      enabledLocales: string;
      supportUrl: string;
      termsUrl: string;
      privacyUrl: string;
      contactEmail: string;
      customDomain: string;
      allowCopyLink: boolean;
      pwaThemeColor: string;
      pwaBgColor: string;
    }>,
  ) {
    this.requireOrgAdmin(user);
    const branding = await this.prisma.branding.upsert({
      where: { orgId: user.orgId! },
      create: {
        orgId: user.orgId!,
        ...sanitize(input),
      },
      update: sanitize(input),
    });
    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'branding.update',
      resource: 'branding',
      resourceId: branding.id,
    });
    return this.toPublic(branding);
  }

  private requireOrg(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('No organization');
  }

  private requireOrgAdmin(user: AuthUser) {
    this.requireOrg(user);
    if (user.role !== Role.ORG_ADMIN && user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Admin only');
    }
  }

  private toPublic(
    b: {
      appName: string;
      shortName: string;
      logoUrl: string | null;
      logoDarkUrl: string | null;
      iconUrl: string | null;
      faviconUrl: string | null;
      primaryColor: string;
      accentColor: string;
      themeDefault: string;
      fontFamily: string;
      defaultLocale: string;
      enabledLocales: string;
      supportUrl: string | null;
      termsUrl: string | null;
      privacyUrl: string | null;
      contactEmail: string | null;
      customDomain: string | null;
      allowCopyLink: boolean;
      pwaThemeColor: string;
      pwaBgColor: string;
    } | null,
  ) {
    return {
      appName: b?.appName ?? 'NeoConfig',
      shortName: b?.shortName ?? 'NeoConfig',
      logoUrl: b?.logoUrl ?? null,
      logoDarkUrl: b?.logoDarkUrl ?? null,
      iconUrl: b?.iconUrl ?? null,
      faviconUrl: b?.faviconUrl ?? null,
      primaryColor: b?.primaryColor ?? '#3B82F6',
      accentColor: b?.accentColor ?? '#22D3EE',
      themeDefault: b?.themeDefault ?? 'dark',
      fontFamily: b?.fontFamily ?? 'Geist',
      defaultLocale: b?.defaultLocale ?? 'en',
      enabledLocales: (b?.enabledLocales ?? 'en,fa,ar').split(','),
      supportUrl: b?.supportUrl ?? null,
      termsUrl: b?.termsUrl ?? null,
      privacyUrl: b?.privacyUrl ?? null,
      contactEmail: b?.contactEmail ?? null,
      customDomain: b?.customDomain ?? null,
      allowCopyLink: b?.allowCopyLink ?? true,
      pwaThemeColor: b?.pwaThemeColor ?? '#0F1115',
      pwaBgColor: b?.pwaBgColor ?? '#0F1115',
    };
  }
}

function sanitize<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
