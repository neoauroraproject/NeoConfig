import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { SslQueueService } from './ssl-queue.service';

@Module({
  controllers: [BrandsController],
  providers: [BrandsService, SslQueueService],
  exports: [BrandsService],
})
export class BrandsModule {}
