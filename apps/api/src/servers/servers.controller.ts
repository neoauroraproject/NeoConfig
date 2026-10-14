import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { ServersService } from './servers.service';

class CreateServerDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

class EnrollDto {
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  hostname?: string;

  @IsOptional()
  @IsString()
  agentVersion?: string;
}

class HeartbeatDto {
  @IsString()
  serverId!: string;

  @IsString()
  agentSecret!: string;

  @IsOptional()
  @IsString()
  agentVersion?: string;

  @IsOptional()
  @IsString()
  hostname?: string;
}

@Controller()
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get('api/v1/admin/servers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  list(@CurrentUser() user: AuthUser) {
    return this.servers.list(user);
  }

  @Post('api/v1/admin/servers')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() body: CreateServerDto) {
    return this.servers.create(user, body.name);
  }

  @Post('api/v1/admin/servers/:id/revoke')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.servers.revoke(user, id);
  }

  @Post('api/v1/agent/enroll')
  enroll(@Body() body: EnrollDto) {
    return this.servers.enroll(body.token, {
      hostname: body.hostname,
      agentVersion: body.agentVersion,
    });
  }

  @Post('api/v1/agent/heartbeat')
  heartbeat(@Body() body: HeartbeatDto) {
    return this.servers.heartbeat(body.serverId, body.agentSecret, {
      agentVersion: body.agentVersion,
      hostname: body.hostname,
    });
  }
}
