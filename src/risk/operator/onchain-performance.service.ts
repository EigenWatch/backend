import { Injectable, LoggerService } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

@Injectable()
export class OperatorOnChainPerformanceService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly logger: LoggerService,
  ) {}

  async calculateOnChainPerformance(
    operatorAddress: string,
  ): Promise<RiskResult> {
    try {
      const [slashingScore, stabilityResult, tenureScore] = await Promise.all([
        this.calculateSlashingHistoryScore(operatorAddress),
        this.calculateDelegationStabilityScore(operatorAddress),
        this.calculateOperationalTenureScore(operatorAddress),
      ]);

      // Weighted combination: slashing (50%), stability (30%), tenure (20%)
      const finalScore =
        slashingScore.score * 0.5 +
        stabilityResult.score * 0.3 +
        tenureScore.score * 0.2;

      const confidence = Math.min(
        slashingScore.confidence,
        stabilityResult.confidence,
        tenureScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          slashingScore: slashingScore.score,
          stabilityScore: stabilityResult.score,
          tenureScore: tenureScore.score,
          volatilityCoefficient:
            stabilityResult.metadata?.volatilityCoefficient,
          growthRate: stabilityResult.metadata?.growthRate,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating on-chain performance for ${operatorAddress}: ${error.message}`,
        error.stack,
        'OperatorOnChainPerformanceService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateSlashingHistoryScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const slashingEvents =
      await this.dataService.getOperatorSlashingEvents(operatorAddress);

    // Base score: no slashing = 100, each slash -25 points, max penalty -50
    const slashingPenalty = Math.min(50, slashingEvents.length * 25);
    const score = 100 - slashingPenalty;

    // Confidence: high if we have comprehensive data
    const confidence = slashingEvents.length > 0 ? 95 : 80;

    return {
      score,
      confidence,
      metadata: {
        slashingEventCount: slashingEvents.length,
        recentSlashing: slashingEvents.some(
          (event) =>
            Date.now() / 1000 - parseInt(event.blockTimestamp) <
            30 * 24 * 60 * 60,
        ),
      },
    };
  }

  private async calculateDelegationStabilityScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const delegationData =
      await this.dataService.calculateDelegationTotals(operatorAddress);

    if (delegationData.monthlyChanges.length < 3) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'Insufficient historical data' },
      };
    }

    // Stability score based on coefficient of variation (lower = better)
    const stabilityScore = Math.max(
      0,
      100 - delegationData.volatilityCoefficient * 100,
    );

    // Growth context (positive growth gets bonus)
    const growthBonus =
      delegationData.growthRate > 0
        ? Math.min(10, delegationData.growthRate * 20)
        : 0;

    const finalScore = Math.min(100, stabilityScore + growthBonus);

    const confidence = this.mathUtils.calculateConfidenceScore(
      delegationData.monthlyChanges.length,
      delegationData.monthlyChanges.length * 30, // days
      false,
      true,
    );

    return {
      score: finalScore,
      confidence,
      metadata: {
        volatilityCoefficient: delegationData.volatilityCoefficient,
        growthRate: delegationData.growthRate,
        delegatorCount: delegationData.delegatorCount,
        totalDelegated: delegationData.totalDelegated,
      },
    };
  }

  private async calculateOperationalTenureScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const operatorInfo =
      await this.dataService.getOperatorRegistrationInfo(operatorAddress);

    if (!operatorInfo?.registeredAt) {
      return { score: 0, confidence: 0 };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const daysActive =
      (currentTime - parseInt(operatorInfo.registeredAt)) / (24 * 60 * 60);

    // Score: linear scaling to 100% after 1 year (365 days)
    const score = Math.min(100, (daysActive / 365) * 100);

    return {
      score,
      confidence: 90, // Registration data is highly reliable
      metadata: {
        daysActive: Math.floor(daysActive),
        registrationTimestamp: operatorInfo.registeredAt,
      },
    };
  }
}
