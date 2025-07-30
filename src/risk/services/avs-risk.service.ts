import { Injectable } from '@nestjs/common';
import { AVSRiskResult } from 'src/common/interfaces/risk.interfaces';
import { AVSEconomicSustainabilityService } from './avs/economic-sustainability.service';
import { AVSOperatorAdoptionQualityService } from './avs/operator-adoption-quality.service';
import { AVSSlashingBehaviorService } from './avs/slashing-behavior.service';
import { AVSTechnicalComplexityService } from './avs/technical-complexity.service';
import { LoggerService } from 'src/common/logger.service';

@Injectable()
export class AVSRiskService {
  constructor(
    private readonly slashingBehaviorService: AVSSlashingBehaviorService,
    private readonly operatorAdoptionService: AVSOperatorAdoptionQualityService,
    private readonly technicalComplexityService: AVSTechnicalComplexityService,
    private readonly economicSustainabilityService: AVSEconomicSustainabilityService,
    private readonly logger: LoggerService,
  ) {}

  async calculateAVSRisk(avsAddress: string): Promise<AVSRiskResult> {
    try {
      this.logger.log(
        `Calculating AVS risk for ${avsAddress}`,
        'AVSRiskService',
      );

      const [slashing, adoption, technical, economic] = await Promise.all([
        this.slashingBehaviorService.calculateSlashingBehavior(avsAddress),
        this.operatorAdoptionService.calculateOperatorAdoptionQuality(
          avsAddress,
        ),
        this.technicalComplexityService.calculateTechnicalComplexity(
          avsAddress,
        ),
        this.economicSustainabilityService.calculateEconomicSustainability(
          avsAddress,
        ),
      ]);

      // Apply methodology weights: 35%, 25%, 20%, 20%
      const overallRiskScore =
        slashing.score * 0.35 +
        adoption.score * 0.25 +
        technical.score * 0.2 +
        economic.score * 0.2;

      const confidence = Math.min(
        slashing.confidence,
        adoption.confidence,
        technical.confidence,
        economic.confidence,
      );

      const result: AVSRiskResult = {
        overallRiskScore: Math.round(overallRiskScore * 100) / 100,
        components: {
          slashingBehavior: slashing,
          operatorAdoptionQuality: adoption,
          technicalComplexity: technical,
          economicSustainability: economic,
        },
        confidence: Math.round(confidence * 100) / 100,
        calculatedAt: new Date(),
      };

      this.logger.log(
        `AVS risk calculated for ${avsAddress}: ${result.overallRiskScore} (confidence: ${result.confidence}%)`,
        'AVSRiskService',
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to calculate AVS risk for ${avsAddress}: ${error.message}`,
        error.stack,
        'AVSRiskService',
      );

      return {
        overallRiskScore: 0,
        components: {
          slashingBehavior: { score: 0, confidence: 0 },
          operatorAdoptionQuality: { score: 0, confidence: 0 },
          technicalComplexity: { score: 0, confidence: 0 },
          economicSustainability: { score: 0, confidence: 0 },
        },
        confidence: 0,
        calculatedAt: new Date(),
      };
    }
  }
}
