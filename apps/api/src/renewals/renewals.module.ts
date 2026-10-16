import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { PanelsModule } from '../panels/panels.module';
import { PublicModule } from '../public/public.module';
import { PushModule } from '../push/push.module';
import { RenewalsController } from './renewals.controller';
import { RenewalsService } from './renewals.service';

@Module({
  imports: [BrandsModule, PanelsModule, PublicModule, PushModule],
  controllers: [RenewalsController],
  providers: [RenewalsService],
})
export class RenewalsModule {}
