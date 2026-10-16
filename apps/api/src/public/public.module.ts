import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { PanelsModule } from '../panels/panels.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [BrandsModule, PanelsModule],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
