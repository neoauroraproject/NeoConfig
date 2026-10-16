import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { PanelsService } from './panels.service';

class CreatePanelDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsIn(['xui', 'pasarguard', 'hmpanel'])
  type?: string;

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  @IsOptional()
  @IsString()
  apiToken?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  subPathHint?: string;
}

class UpdatePanelDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(['xui', 'pasarguard', 'hmpanel']) type?: string;
  @IsOptional() @IsUrl({ require_tld: false }) baseUrl?: string;
  @IsOptional() @IsString() apiToken?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() subPathHint?: string;
}

@Controller('api/v1/admin/panels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class PanelsController {
  constructor(private readonly panels: PanelsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.panels.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreatePanelDto) {
    return this.panels.create(user, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdatePanelDto) {
    return this.panels.update(user, id, body);
  }

  @Post(':id/test')
  test(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panels.test(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.panels.remove(user, id);
  }
}
