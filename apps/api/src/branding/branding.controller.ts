import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { BrandingService } from './branding.service';

class UpdateBrandingDto {
  @IsOptional() @IsString() appName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() logoDarkUrl?: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() faviconUrl?: string;
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() accentColor?: string;
  @IsOptional() @IsString() themeDefault?: string;
  @IsOptional() @IsString() fontFamily?: string;
  @IsOptional() @IsString() defaultLocale?: string;
  @IsOptional() @IsString() enabledLocales?: string;
  @IsOptional() @IsString() supportUrl?: string;
  @IsOptional() @IsString() termsUrl?: string;
  @IsOptional() @IsString() privacyUrl?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() customDomain?: string;
  @IsOptional() @IsBoolean() allowCopyLink?: boolean;
  @IsOptional() @IsString() pwaThemeColor?: string;
  @IsOptional() @IsString() pwaBgColor?: string;
}

@Controller()
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get('api/v1/branding')
  publicBranding(@Query('tenant') tenant?: string) {
    return this.branding.getPublic(tenant);
  }

  @Get('api/v1/admin/branding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  adminGet(@CurrentUser() user: AuthUser) {
    return this.branding.getForOrg(user);
  }

  @Patch('api/v1/admin/branding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  adminUpdate(@CurrentUser() user: AuthUser, @Body() body: UpdateBrandingDto) {
    return this.branding.update(user, body);
  }
}
