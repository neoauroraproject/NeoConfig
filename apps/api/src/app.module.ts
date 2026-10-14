import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { HmPanelModule } from './hmpanel/hmpanel.module';
import { PanelsModule } from './panels/panels.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServersModule } from './servers/servers.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL || 60) * 1000,
        limit: Number(process.env.RATE_LIMIT_MAX || 120),
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    SubscriptionsModule,
    PanelsModule,
    BrandingModule,
    ServersModule,
    HmPanelModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
