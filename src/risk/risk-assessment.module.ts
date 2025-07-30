import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';

import { DataService } from 'src/common/data/data.service';
import { LoggerService } from 'src/common/logger.service';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

import { AVSTechnicalComplexityService } from './services/avs/technical-complexity.service';
import { AVSOperatorAdoptionQualityService } from './services/avs/operator-adoption-quality.service';
import { AVSEconomicSustainabilityService } from './services/avs/economic-sustainability.service';
import { AVSSlashingBehaviorService } from './services/avs/slashing-behavior.service';

import { OperatorAVSSelectionBehaviorService } from './services/operator/avs-selection-behavior.service';
import { OperatorEconomicBehaviorService } from './services/operator/economic-behavior.service';
import { OperatorNetworkPositionService } from './services/operator/network-position.service';
import { OperatorOnChainPerformanceService } from './services/operator/onchain-performance.service';

import { AVSRiskService } from './services/avs-risk.service';
import { CorrelationService } from './services/correlation.service';
import { OperatorRiskService } from './services/operator-risk.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
  ],
  providers: [
    // Core services
    LoggerService,
    DataService,
    MathUtilsService,
    CorrelationService,

    // Operator risk services
    OperatorOnChainPerformanceService,
    OperatorEconomicBehaviorService,
    OperatorAVSSelectionBehaviorService,
    OperatorNetworkPositionService,
    OperatorRiskService,

    // AVS risk services
    AVSSlashingBehaviorService,
    AVSTechnicalComplexityService,
    AVSOperatorAdoptionQualityService,
    AVSEconomicSustainabilityService,
    AVSRiskService,
  ],
  exports: [OperatorRiskService, AVSRiskService, DataService, MathUtilsService],
})
export class RiskAssessmentModule {}
