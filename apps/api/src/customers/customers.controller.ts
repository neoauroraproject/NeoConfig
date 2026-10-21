import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CustomersService } from './customers.service';

class SubDto {
  @IsString() @MaxLength(128) subId!: string;
  @IsString() @MaxLength(2048) url!: string;
}

class TenantDto {
  @IsOptional() @IsString() tenant?: string;
}

class CredentialsDto extends TenantDto {
  @IsString() @MaxLength(32) username!: string;
  @IsString() @MaxLength(128) password!: string;
}

class RegisterDto extends CredentialsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SubDto) accounts!: SubDto[];
}

class TokenDto extends TenantDto {
  @IsString() @MaxLength(128) token!: string;
}

class SyncDto extends TokenDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SubDto) accounts!: SubDto[];
}

class PasswordDto extends TokenDto {
  @IsString() @MaxLength(128) current!: string;
  @IsString() @MaxLength(128) next!: string;
}

/** Storefront customer logins (tokens travel in the body, never in URLs). */
@Controller('api/v1/public/account')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post('register')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: RegisterDto) {
    return this.customers.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  login(@Body() body: CredentialsDto) {
    return this.customers.login(body);
  }

  @Post('me')
  @HttpCode(200)
  me(@Body() body: TokenDto) {
    return this.customers.me(body);
  }

  @Post('sync')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  sync(@Body() body: SyncDto) {
    return this.customers.sync(body);
  }

  @Post('password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  password(@Body() body: PasswordDto) {
    return this.customers.changePassword(body);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: TokenDto) {
    return this.customers.logout(body.token);
  }
}
