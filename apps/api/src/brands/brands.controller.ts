import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BrandsService } from './brands.service';

class PlanDto {
  @IsOptional() @IsString() id!: string;
  @IsString() @MaxLength(60) title!: string;
  @IsNumber() days!: number;
  @IsNumber() gb!: number;
  @IsString() @MaxLength(40) price!: string;
}

class BrandDto {
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() appName?: string;
  @IsOptional() @IsString() shortName?: string;
  @IsOptional() @IsString() tagline?: string | null;
  @IsOptional() @IsString() logoUrl?: string | null;
  @IsOptional() @IsString() iconUrl?: string | null;
  @IsOptional() @IsString() primaryColor?: string;
  @IsOptional() @IsString() accentColor?: string;
  @IsOptional() @IsString() theme?: string;
  @IsOptional() @IsString() defaultLocale?: string;
  @IsOptional() @IsString() supportUrl?: string | null;
  @IsOptional() @IsString() supportTelegram?: string | null;
  @IsOptional() @IsString() contactEmail?: string | null;
  @IsOptional() @IsBoolean() allowCopyLink?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsString() ownerId?: string | null;
  @IsOptional() @IsBoolean() renewalEnabled?: boolean;
  @IsOptional() @IsString() cardNumber?: string | null;
  @IsOptional() @IsString() cardHolder?: string | null;
  @IsOptional() @IsString() bankName?: string | null;
  @IsOptional() @IsString() renewalNote?: string | null;
  @IsOptional() @IsBoolean() expiryRemindersEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(200) telegramBotToken?: string;
  @IsOptional() @IsString() @MaxLength(64) telegramChatId?: string | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PlanDto) plans?: PlanDto[];
  @IsOptional() @IsArray() @IsString({ each: true }) panelIds?: string[];
}

class DomainDto {
  @IsString() @MaxLength(253) domain!: string;
}

@Controller('api/v1/admin/brands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.brands.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: BrandDto) {
    return this.brands.create(user, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BrandDto) {
    return this.brands.update(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.remove(user, id);
  }

  @Post(':id/domains')
  addDomain(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: DomainDto) {
    return this.brands.addDomain(user, id, body.domain);
  }

  @Delete(':id/domains/:domainId')
  removeDomain(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('domainId') domainId: string) {
    return this.brands.removeDomain(user, id, domainId);
  }

  @Post(':id/telegram/test')
  telegramTest(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.telegramTest(user, id);
  }

  @Post(':id/domains/:domainId/check')
  checkDomain(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('domainId') domainId: string) {
    return this.brands.checkDomain(user, id, domainId);
  }
}
