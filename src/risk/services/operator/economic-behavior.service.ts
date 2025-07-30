import { Injectable } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { LoggerService } from 'src/common/logger.service';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

@Injectable()
export class OperatorEconomicBehaviorService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly logger: LoggerService,
  ) {}

  async calculateEconomicBehavior(
    operatorAddress: string,
  ): Promise<RiskResult> {
    try {
      const [concentrationScore, feeScore, growthScore] = await Promise.all([
        this.calculateDelegationConcentrationRisk(operatorAddress),
        this.calculateFeeStructureReasonableness(operatorAddress),
        this.calculateGrowthPatternSustainability(operatorAddress),
      ]);

      // Weighted combination: concentration (40%), fees (35%), growth (25%)
      const finalScore =
        concentrationScore.score * 0.4 +
        feeScore.score * 0.35 +
        growthScore.score * 0.25;

      const confidence = Math.min(
        concentrationScore.confidence,
        feeScore.confidence,
        growthScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          concentrationRisk: concentrationScore.metadata,
          feeStructure: feeScore.metadata,
          growthPattern: growthScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating economic behavior for ${operatorAddress}: ${error.message}`,
        error.stack,
        'OperatorEconomicBehaviorService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateDelegationConcentrationRisk(
    operatorAddress: string,
  ): Promise<RiskResult> {
    // const delegationData =
    //   await this.dataService.calculateDelegationTotals(operatorAddress);
    const shareEvents =
      await this.dataService.getOperatorDelegationHistory(operatorAddress);

    // Group by staker to get individual delegator amounts
    const delegatorAmounts = new Map<string, number>();

    for (const event of shareEvents) {
      const stakerId = event.staker.id;
      const shares = parseFloat(event.shares);

      if (event.eventType === 'INCREASED') {
        delegatorAmounts.set(
          stakerId,
          (delegatorAmounts.get(stakerId) || 0) + shares,
        );
      } else {
        delegatorAmounts.set(
          stakerId,
          Math.max(0, (delegatorAmounts.get(stakerId) || 0) - shares),
        );
      }
    }

    const amounts = Array.from(delegatorAmounts.values()).filter(
      (amount) => amount > 0,
    );
    const hhi = this.mathUtils.calculateHHI(amounts);

    // Convert HHI to risk score (lower HHI = better diversification = higher score)
    const score = Math.max(0, 100 - hhi * 100);

    return {
      score,
      confidence: amounts.length >= 5 ? 85 : 60,
      metadata: {
        hhi,
        delegatorCount: amounts.length,
        topDelegatorPercentage:
          amounts.length > 0
            ? Math.max(...amounts) / amounts.reduce((a, b) => a + b, 0)
            : 0,
      },
    };
  }

  //   TODO: This should take account of commission types
  private async calculateFeeStructureReasonableness(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const commissionEvents =
      await this.dataService.getOperatorCommissionEvents(operatorAddress);

    if (commissionEvents.length === 0) {
      // No commission data available - assume default
      return {
        score: 75,
        confidence: 40,
        metadata: {
          reason: 'No commission data available',
          assumedDefaultRate: true,
        },
      };
    }

    // Get most recent commission rates by type
    const latestCommissions = new Map<string, number>();

    for (const event of commissionEvents) {
      const key = event.commissionType;
      const commission = parseInt(event.newCommissionBips) / 100; // Convert to percentage

      if (
        !latestCommissions.has(key) ||
        parseInt(event.blockTimestamp) >
          parseInt(
            commissionEvents.find((e) => e.commissionType === key)
              ?.blockTimestamp || '0',
          )
      ) {
        latestCommissions.set(key, commission);
      }
    }

    // Score based on reasonableness of commission rates
    let totalScore = 0;
    let weightedCount = 0;

    for (const [type, rate] of latestCommissions) {
      let rateScore = 0;

      if (rate >= 5 && rate <= 15) {
        rateScore = 100; // Optimal range
      } else if (rate < 5) {
        rateScore = 70; // Potentially unsustainable
      } else if (rate <= 25) {
        rateScore = 75 - (rate - 15) * 2.5; // Linear decrease
      } else {
        rateScore = 25; // Excessive
      }

      totalScore += rateScore;
      weightedCount++;
    }

    const avgScore = weightedCount > 0 ? totalScore / weightedCount : 75;

    return {
      score: avgScore,
      confidence: 80,
      metadata: {
        commissionRates: Object.fromEntries(latestCommissions),
        avgCommission:
          Array.from(latestCommissions.values()).reduce((a, b) => a + b, 0) /
          latestCommissions.size,
      },
    };
  }

  private async calculateGrowthPatternSustainability(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const delegationData =
      await this.dataService.calculateDelegationTotals(operatorAddress);

    if (delegationData.monthlyChanges.length < 3) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'Insufficient growth data' },
      };
    }

    // Calculate growth rate volatility
    const growthRates: number[] = [];
    for (let i = 1; i < delegationData.monthlyChanges.length; i++) {
      const prevValue = delegationData.monthlyChanges[i - 1];
      const currValue = delegationData.monthlyChanges[i];
      if (prevValue > 0) {
        growthRates.push((currValue - prevValue) / prevValue);
      }
    }

    const growthVolatility =
      this.mathUtils.calculateStandardDeviation(growthRates);
    const avgGrowthRate =
      growthRates.reduce((a, b) => a + b, 0) / growthRates.length;

    // Score based on sustainable growth (positive but not too volatile)
    let score = 50; // Base score

    // Bonus for positive growth
    if (avgGrowthRate > 0) {
      score += Math.min(25, avgGrowthRate * 50);
    } else if (avgGrowthRate < -0.1) {
      score -= 25; // Penalty for significant decline
    }

    // Penalty for high volatility
    if (growthVolatility > 0.5) {
      score -= 20;
    } else if (growthVolatility > 0.2) {
      score -= 10;
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      confidence: 75,
      metadata: {
        avgGrowthRate,
        growthVolatility,
        trendDirection:
          avgGrowthRate > 0
            ? 'positive'
            : avgGrowthRate < 0
              ? 'negative'
              : 'stable',
      },
    };
  }
}
