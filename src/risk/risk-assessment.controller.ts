import { Controller, Get, Param, Query } from '@nestjs/common';
import { AVSRiskService } from './services/avs-risk.service';
import { OperatorRiskService } from './services/operator-risk.service';

@Controller('risk')
export class RiskAssessmentController {
  constructor(
    private readonly operatorRiskService: OperatorRiskService,
    private readonly avsRiskService: AVSRiskService,
  ) {}

  @Get('operator/:address')
  async getOperatorRisk(@Param('address') address: string) {
    return this.operatorRiskService.calculateOperatorRisk(address);
  }

  @Get('avs/:address')
  async getAVSRisk(@Param('address') address: string) {
    return this.avsRiskService.calculateAVSRisk(address);
  }

  @Get('operators/batch')
  async getBatchOperatorRisks(@Query('addresses') addresses: string) {
    const addressList = addresses.split(',').map((addr) => addr.trim());
    const results =
      await this.operatorRiskService.calculateMultipleOperatorRisks(
        addressList,
      );
    return Object.fromEntries(results);
  }
}
