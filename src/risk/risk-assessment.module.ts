import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LoggerService } from 'src/common/logger.service';

import { OperatorRiskService } from './services/operator-risk.service';
import { RedisCacheService } from 'src/common/redis-cache.service';

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
    RedisCacheService,

    // Risk assessment services
    OperatorRiskService,
  ],
  exports: [OperatorRiskService],
})
export class RiskAssessmentModule {}
