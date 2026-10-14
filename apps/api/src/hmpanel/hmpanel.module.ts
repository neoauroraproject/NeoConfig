import { Module } from '@nestjs/common';
import { HmPanelController } from './hmpanel.controller';
import { HmPanelService } from './hmpanel.service';

@Module({
  controllers: [HmPanelController],
  providers: [HmPanelService],
  exports: [HmPanelService],
})
export class HmPanelModule {}
