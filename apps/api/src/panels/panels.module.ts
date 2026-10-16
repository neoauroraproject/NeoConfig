import { Module } from '@nestjs/common';
import { HmPanelClientService } from '../integrations/hmpanel/hmpanel.client';
import { PasarGuardClientService } from '../integrations/pasarguard/pasarguard.client';
import { XuiClientService } from '../integrations/xui/xui.client';
import { PanelGatewayService } from './panel-gateway.service';
import { PanelsController } from './panels.controller';
import { PanelsService } from './panels.service';

@Module({
  controllers: [PanelsController],
  providers: [PanelsService, PanelGatewayService, XuiClientService, PasarGuardClientService, HmPanelClientService],
  exports: [PanelsService, PanelGatewayService, XuiClientService, PasarGuardClientService, HmPanelClientService],
})
export class PanelsModule {}
