import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { BrandsService } from '../brands/brands.service';
import { NetworkStatusService } from './network-status.service';
import { PublicService } from './public.service';

class LookupDto {
  /** A subscription link, or one of its configs (`vless://…`) — see PublicService.resolveInput. */
  @IsString()
  @MaxLength(8192)
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
    private readonly network: NetworkStatusService,
  ) {}

  /** The brand's network status (NeoUptime), for the small box in the app. */
  @Get('network-status')
  networkStatus(@Query('tenant') tenant?: string) {
    return this.network.forTenant(tenant);
  }

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

  @Get('brands/:slug/logo-dark')
  async logoDark(@Param('slug') slug: string, @Res() res: Response) {
    const logo = (await this.brands.logo(slug, 'dark')) ?? (await this.brands.logo(slug));
    if (!logo) throw new NotFoundException();
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(logo.data);
  }

  @Get('brands/:slug/logo')
  async logo(@Param('slug') slug: string, @Res() res: Response) {
    const logo = await this.brands.logo(slug);
    if (!logo) throw new NotFoundException();
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(logo.data);
  }

  /** The SSL worker asks this before issuing a certificate for a brand domain. */
  @Get('domain-check')
  async domainCheck(@Query('domain') domain?: string) {
    if (domain && (await this.brands.isServedDomain(domain))) return { ok: true };
    throw new NotFoundException();
  }
}
