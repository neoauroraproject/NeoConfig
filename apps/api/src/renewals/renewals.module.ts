import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { PanelsModule } from '../panels/panels.module';
import { PublicModule } from '../public/public.module';
import { PushModule } from '../push/push.module';
import { CustomersModule } from '../customers/customers.module';
import { RenewalsController } from './renewals.controller';
import { RenewalsService } from './renewals.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

@Module({
  imports: [BrandsModule, PanelsModule, PublicModule, PushModule, CustomersModule],
  controllers: [RenewalsController, TelegramWebhookController],
  providers: [RenewalsService],
})
export class RenewalsModule {}
