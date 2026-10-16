import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BrandsModule } from './brands/brands.module';
import { HmPanelModule } from './hmpanel/hmpanel.module';
import { PanelsModule } from './panels/panels.module';
import { PrismaModule } from './prisma/prisma.module';
import { ServersModule } from './servers/servers.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { HealthController } from './health.controller';
import { PublicModule } from './public/public.module';
import { PushModule } from './push/push.module';
import { RenewalsModule } from './renewals/renewals.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL || 60) * 1000,
        limit: Number(process.env.RATE_LIMIT_MAX || 120),
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    PublicModule,
    SubscriptionsModule,
    PanelsModule,
    BrandsModule,
    PushModule,
    RenewalsModule,
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
