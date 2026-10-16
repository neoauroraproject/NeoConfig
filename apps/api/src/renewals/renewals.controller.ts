import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RenewalsService } from './renewals.service';

class CreateRenewalDto {
  @IsOptional() @IsString() tenant?: string;
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] }) @MaxLength(2048) url!: string;
  @IsString() @MaxLength(24) planId!: string;
  @IsString() @MaxLength(4_500_000) receipt!: string;
  @IsOptional() @IsString() @MaxLength(80) payerName?: string;
  @IsOptional() @IsString() @MaxLength(300) payerNote?: string;
  @IsOptional() @IsString() @MaxLength(1024) deviceEndpoint?: string;
}

class StatusDto {
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) ids!: string[];
}

class DecideDto {
  @IsOptional() @IsBoolean() apply?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

const ADMIN_ROLES = [Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER];

@Controller('api/v1')
export class RenewalsController {
  constructor(private readonly renewals: RenewalsService) {}

  @Post('public/renewals')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() body: CreateRenewalDto) {
    return this.renewals.create(body);
  }

  @Post('public/renewals/status')
  @HttpCode(200)
  status(@Body() body: StatusDto) {
    return this.renewals.statuses(body.ids);
  }

  @Get('admin/renewals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('brandId') brandId?: string) {
    return this.renewals.list(user, { status, brandId });
  }

  @Get('admin/renewals/:id/receipt')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  async receipt(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { mime, data } = await this.renewals.receipt(user, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }

  @Post('admin/renewals/:id/approve')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: DecideDto) {
    return this.renewals.approve(user, id, { apply: Boolean(body.apply), note: body.note });
  }

  @Post('admin/renewals/:id/reject')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ADMIN_ROLES)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: DecideDto) {
    return this.renewals.reject(user, id, body.note);
  }
}
