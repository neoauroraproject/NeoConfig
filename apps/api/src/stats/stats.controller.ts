import { Body, Controller, Get, Headers, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StatsService } from './stats.service';

class TrackDto {
  @IsOptional() @IsString() @MaxLength(253) tenant?: string;
  /** Random ID the app keeps in local storage. */
  @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) deviceId!: string;
  @IsIn(['open', 'add']) event!: 'open' | 'add';
  @IsOptional() @IsBoolean() standalone?: boolean;
  @IsOptional() @IsString() @MaxLength(8) locale?: string;
  @IsOptional() @IsString() @MaxLength(120) subId?: string;
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
}

@Controller('api/v1')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Post('public/track')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  track(@Body() body: TrackDto, @Headers('user-agent') ua?: string) {
    return this.stats.track({ ...body, userAgent: ua });
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER)
  overview(@CurrentUser() user: AuthUser, @Query('brandId') brandId?: string, @Query('days') days?: string) {
    return this.stats.overview(user, { brandId: brandId || undefined, days: days ? Number(days) : undefined });
  }
}
