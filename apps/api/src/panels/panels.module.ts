import { Module } from '@nestjs/common';
import { PasarGuardClientService } from '../integrations/pasarguard/pasarguard.client';
import { XuiClientService } from '../integrations/xui/xui.client';
import { PanelGatewayService } from './panel-gateway.service';
import { PanelsController } from './panels.controller';
import { PanelsService } from './panels.service';

@Module({
  controllers: [PanelsController],
  providers: [PanelsService, PanelGatewayService, XuiClientService, PasarGuardClientService],
  exports: [PanelsService, PanelGatewayService, XuiClientService, PasarGuardClientService],
})
export class PanelsModule {}
