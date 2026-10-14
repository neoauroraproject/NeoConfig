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
import { IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth.types';
import { SubscriptionsService } from './subscriptions.service';

class UrlDto {
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  url!: string;
}

class CreateDto extends UrlDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

class MetaDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

@Controller('api/v1/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.subscriptions.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.get(user, id);
  }

  @Post('preview')
  preview(@CurrentUser() user: AuthUser, @Body() body: UrlDto) {
    return this.subscriptions.preview(user, body.url);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateDto) {
    return this.subscriptions.create(user, body);
  }

  @Post(':id/refresh')
  refresh(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.refresh(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: MetaDto,
  ) {
    return this.subscriptions.updateMeta(user, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subscriptions.remove(user, id);
  }
}
