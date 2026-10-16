import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    name?: string;
    orgName?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existing) throw new ConflictException('Email already registered');

    const slugBase = (input.orgName || input.email.split('@')[0])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    const org = await this.prisma.organization.create({
      data: {
        name: input.orgName || 'My Organization',
        slug: `${slugBase}-${Date.now().toString(36)}`,
        brands: {
          create: {
            slug: `${slugBase}-${Date.now().toString(36)}`,
            appName: this.config.get('APP_NAME') || 'NeoConfig',
            isDefault: true,
          },
        },
        hmpanel: { create: { configured: false } },
      },
    });

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        name: input.name,
        role: Role.ORG_ADMIN,
        orgId: org.id,
      },
    });

    await this.audit.log({
      orgId: org.id,
      userId: user.id,
      action: 'auth.register',
      resource: 'user',
      resourceId: user.id,
    });

    return this.tokenResponse(user);
  }

  async login(email: string, password: string, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.audit.log({
      orgId: user.orgId,
      userId: user.id,
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      ip,
    });

    return this.tokenResponse(user);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      name: user.name,
      locale: user.locale,
      theme: user.theme,
    };
  }

  private tokenResponse(user: {
    id: string;
    email: string;
    role: Role;
    orgId: string | null;
    name: string | null;
    locale: string;
    theme: string;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
    };
    const accessToken = this.jwt.sign(payload);
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        name: user.name,
        locale: user.locale,
        theme: user.theme,
      },
    };
  }
}
