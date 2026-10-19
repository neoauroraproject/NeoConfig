import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [BrandsModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
