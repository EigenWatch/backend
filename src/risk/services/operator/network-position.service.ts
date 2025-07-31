import { Injectable } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { LoggerService } from 'src/common/logger.service';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

// TODO: Review this again
@Injectable()
export class OperatorNetworkPositionService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly logger: LoggerService,
  ) {}

  async calculateNetworkPosition(operatorAddress: string): Promise<RiskResult> {
    try {
      const [sizeScore, distributionScore] = await Promise.all([
        this.calculateRelativeSizeScore(operatorAddress),
        this.calculateDelegatorDistributionQuality(operatorAddress),
      ]);

      // Weighted combination: size (60%), distribution quality (40%)
      const finalScore = sizeScore.score * 0.6 + distributionScore.score * 0.4;
      const confidence = Math.min(
        sizeScore.confidence,
        distributionScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          relativeSize: sizeScore.metadata,
          distributionQuality: distributionScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating network position for ${operatorAddress}: ${error.message}`,
        error.stack,
        'OperatorNetworkPositionService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateRelativeSizeScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const [operatorData, allOperators] = await Promise.all([
      this.dataService.calculateDelegationTotals(operatorAddress),
      this.dataService.getAllOperators(100), // Get top 100 operators
    ]);

    // Get delegation totals for all operators (simplified - in reality would need to calculate)
    const allDelegationTotals = await Promise.all(
      allOperators.slice(0, 100).map(async (op) => {
        // Limit to top 100 for performance
        try {
          const data = await this.dataService.calculateDelegationTotals(
            op.address,
          );
          return data.totalDelegated;
        } catch {
          return 0;
        }
      }),
    );

    const percentile = this.mathUtils.calculatePercentileRank(
      operatorData.totalDelegated,
      allDelegationTotals,
    );

    // Size premium: operators in higher percentiles get bonus for scale advantages
    const score = Math.min(100, percentile + 20);

    return {
      score,
      confidence: allDelegationTotals.length >= 50 ? 80 : 60,
      metadata: {
        totalDelegated: operatorData.totalDelegated,
        percentileRank: percentile,
        comparedAgainst: allDelegationTotals.length,
      },
    };
  }

  private async calculateDelegatorDistributionQuality(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const delegationData =
      await this.dataService.calculateDelegationTotals(operatorAddress);
    const shareEvents =
      await this.dataService.getOperatorDelegationHistory(operatorAddress);

    // Calculate delegator amounts distribution
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

    if (amounts.length === 0) {
      return {
        score: 0,
        confidence: 0,
        metadata: { reason: 'No active delegators' },
      };
    }

    // Calculate coefficient of variation for distribution evenness
    const cv = this.mathUtils.calculateCoefficientOfVariation(amounts);

    // Lower CV indicates more even distribution (better)
    const distributionScore = Math.max(0, 100 - cv * 50);

    // Bonus for having many delegators
    const delegatorCountBonus = Math.min(20, Math.log10(amounts.length) * 10);

    const finalScore = Math.min(100, distributionScore + delegatorCountBonus);

    return {
      score: finalScore,
      confidence: amounts.length >= 10 ? 85 : 70,
      metadata: {
        delegatorCount: amounts.length,
        distributionCV: cv,
        avgDelegation: amounts.reduce((a, b) => a + b, 0) / amounts.length,
        medianDelegation: amounts.sort((a, b) => a - b)[
          Math.floor(amounts.length / 2)
        ],
      },
    };
  }
}
