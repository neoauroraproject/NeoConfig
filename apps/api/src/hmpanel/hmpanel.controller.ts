import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthUser } from '../auth/auth.types';
import { HmPanelService } from './hmpanel.service';

@Controller('api/v1')
export class HmPanelController {
  constructor(private readonly hmpanel: HmPanelService) {}

  @Get('admin/hmpanel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  status(@CurrentUser() user: AuthUser) {
    return this.hmpanel.status(user);
  }

  @Get('subscriptions/:id/renewal')
  @UseGuards(JwtAuthGuard)
  renewal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hmpanel.renewalAvailable(user, id);
  }
}
