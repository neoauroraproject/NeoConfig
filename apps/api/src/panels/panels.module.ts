import { Module } from '@nestjs/common';
import { XuiClientService } from '../integrations/xui/xui.client';
import { PanelsController } from './panels.controller';
import { PanelsService } from './panels.service';

@Module({
  controllers: [PanelsController],
  providers: [PanelsService, XuiClientService],
  exports: [PanelsService],
})
export class PanelsModule {}
