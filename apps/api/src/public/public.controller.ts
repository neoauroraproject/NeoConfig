import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { BrandsService } from '../brands/brands.service';
import { PublicService } from './public.service';

class LookupDto {
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  @IsString()
  tenant?: string;
}

@Controller('api/v1/public')
export class PublicController {
  constructor(
    private readonly publicService: PublicService,
    private readonly brands: BrandsService,
  ) {}

  @Get('branding')
  branding(@Query('tenant') tenant?: string) {
    return this.publicService.branding(tenant);
  }

  @Post('lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  lookup(@Body() body: LookupDto) {
    return this.publicService.lookupForTenant(body.url, body.tenant);
  }

  /** Caddy `on_demand_tls { ask … }` — 200 lets it issue a certificate. */
  @Get('domain-check')
  async domainCheck(@Query('domain') domain?: string) {
    if (domain && (await this.brands.isServedDomain(domain))) return { ok: true };
    throw new NotFoundException();
  }
}
