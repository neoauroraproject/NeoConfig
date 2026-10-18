import { Module } from '@nestjs/common';
import { PanelsModule } from '../panels/panels.module';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { SslQueueService } from './ssl-queue.service';

@Module({
  imports: [PanelsModule],
  controllers: [BrandsController],
  providers: [BrandsService, SslQueueService],
  exports: [BrandsService],
})
export class BrandsModule {}
