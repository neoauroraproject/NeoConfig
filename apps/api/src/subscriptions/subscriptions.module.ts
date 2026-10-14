import { Module } from '@nestjs/common';
import { XuiClientService } from '../integrations/xui/xui.client';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, XuiClientService],
  exports: [SubscriptionsService, XuiClientService],
})
export class SubscriptionsModule {}
