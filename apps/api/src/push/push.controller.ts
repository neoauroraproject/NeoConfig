import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { BrandsService } from '../brands/brands.service';
import { PushService } from './push.service';

class KeysDto {
  @IsString() @MaxLength(256) p256dh!: string;
  @IsString() @MaxLength(256) auth!: string;
}

class SubscriptionDto {
  @IsUrl({ protocols: ['https'], require_tld: false }) @MaxLength(1024) endpoint!: string;
  @ValidateNested() @Type(() => KeysDto) keys!: KeysDto;
}

class FollowDto {
  @IsString() @MaxLength(128) subId!: string;
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] }) @MaxLength(2048) url!: string;
}

class SubscribeDto {
  @IsOptional() @IsString() tenant?: string;
  @ValidateNested() @Type(() => SubscriptionDto) subscription!: SubscriptionDto;
  /** Older clients send only ids; they get status pushes but no expiry reminders. */
  @IsOptional() @IsArray() @IsString({ each: true }) subIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => FollowDto) accounts?: FollowDto[];
}

class UnsubscribeDto {
  @IsString() @MaxLength(1024) endpoint!: string;
}

class TrackDto {
  @IsString() @MaxLength(64) id!: string;
  @IsIn(['delivered', 'opened']) event!: 'delivered' | 'opened';
}

class BroadcastDto {
  @IsString() @MaxLength(80) title!: string;
  @IsString() @MaxLength(240) body!: string;
}

@Controller('api/v1')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly brands: BrandsService,
  ) {}

  @Get('public/push/key')
  key() {
    return { publicKey: this.push.getPublicKey() };
  }

  @Post('public/push/subscribe')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async subscribe(@Body() body: SubscribeDto) {
    const brand = await this.brands.resolve(body.tenant);
    if (!brand) return { ok: false };
    return this.push.register({
      brandId: brand.id,
      endpoint: body.subscription.endpoint,
      p256dh: body.subscription.keys.p256dh,
      auth: body.subscription.keys.auth,
      subIds: body.subIds ?? [],
      accounts: body.accounts ?? [],
    });
  }

  @Post('public/push/check')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  check(@Body() body: UnsubscribeDto) {
    return this.push.isRegistered(body.endpoint);
  }

  @Post('public/push/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  test(@Body() body: UnsubscribeDto) {
    return this.push.testDevice(body.endpoint);
  }

  @Post('public/push/unsubscribe')
  unsubscribe(@Body() body: UnsubscribeDto) {
    return this.push.unregister(body.endpoint);
  }

  /** The service worker: a notification was shown / tapped. */
  @Post('public/push/track')
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  track(@Body() body: TrackDto) {
    return this.push.track(body.id, body.event);
  }

  @Get('admin/brands/:id/push/logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER)
  async logs(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    const brand = await this.brands.mustOwn(user, id);
    return this.push.logs(brand.id, Number(limit) || 50);
  }

  @Post('admin/brands/:id/push')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER)
  async broadcast(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: BroadcastDto) {
    const brand = await this.brands.mustOwn(user, id);
    return this.push.broadcast(brand.id, { title: body.title, body: body.body, url: '/', tag: 'broadcast' });
  }
}
