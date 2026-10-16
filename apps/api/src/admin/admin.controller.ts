import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { AdminService } from './admin.service';

class CreateMemberDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(['RESELLER', 'ORG_ADMIN']) role?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) brandIds?: string[];
}

class UpdateMemberDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) brandIds?: string[];
}

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN, Role.RESELLER)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.admin.overview(user);
  }

  @Get('audit')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  audit(@CurrentUser() user: AuthUser) {
    return this.admin.audit_(user);
  }

  @Get('team')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  team(@CurrentUser() user: AuthUser) {
    return this.admin.team(user);
  }

  @Post('team')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  createMember(@CurrentUser() user: AuthUser, @Body() body: CreateMemberDto) {
    return this.admin.createMember(user, body);
  }

  @Patch('team/:id')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  updateMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: UpdateMemberDto) {
    return this.admin.updateMember(user, id, body);
  }

  @Delete('team/:id')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  removeMember(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.removeMember(user, id);
  }
}
