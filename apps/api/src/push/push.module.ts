import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { PublicModule } from '../public/public.module';
import { ExpiryRemindersService } from './expiry-reminders.service';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [BrandsModule, PublicModule],
  controllers: [PushController],
  providers: [PushService, ExpiryRemindersService],
  exports: [PushService],
})
export class PushModule {}
