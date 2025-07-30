import { Injectable } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { MathUtilsService } from 'src/common/utils/math-utils.service';
import { CorrelationService } from '../correlation.service';
import { LoggerService } from 'src/common/logger.service';

@Injectable()
export class OperatorAVSSelectionBehaviorService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly correlationService: CorrelationService,
    private readonly logger: LoggerService,
  ) {}

  async calculateAVSSelectionBehavior(
    operatorAddress: string,
  ): Promise<RiskResult> {
    try {
      const [diversityScore, timingScore, portfolioRisk] = await Promise.all([
        this.calculateServiceDiversityScore(operatorAddress),
        this.calculateSelectionTimingScore(operatorAddress),
        this.calculatePortfolioRiskScore(operatorAddress),
      ]);

      // Weighted combination: diversity (40%), timing (30%), portfolio risk (30%)
      const finalScore =
        diversityScore.score * 0.4 +
        timingScore.score * 0.3 +
        portfolioRisk.score * 0.3;

      const confidence = Math.min(
        diversityScore.confidence,
        timingScore.confidence,
        portfolioRisk.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          serviceDiversity: diversityScore.metadata,
          selectionTiming: timingScore.metadata,
          portfolioRisk: portfolioRisk.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating AVS selection behavior for ${operatorAddress}: ${error.message}`,
        error.stack,
        'OperatorAVSSelectionBehaviorService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateServiceDiversityScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const memberships =
      await this.dataService.getOperatorSetMemberships(operatorAddress);
    const activeMemberships = memberships.filter((m) => m.isActive);
    const uniqueAVS = new Set(
      activeMemberships.map((m) => m.operatorSet.avs.id),
    );

    const serviceCount = uniqueAVS.size;
    let score = 0;

    // Scoring based on optimal diversification range
    if (serviceCount === 0) {
      score = 0;
    } else if (serviceCount <= 2) {
      score = 25; // Under-diversified
    } else if (serviceCount <= 8) {
      score = 75 + (serviceCount - 3) * 5; // Optimal range: 75-100
    } else if (serviceCount <= 15) {
      score = 75 - (serviceCount - 8) * 3; // Over-extended: 75-54
    } else {
      score = 25; // Severely over-extended
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      confidence: activeMemberships.length > 0 ? 85 : 40,
      metadata: {
        activeServices: serviceCount,
        totalMemberships: activeMemberships.length,
        uniqueAVSList: Array.from(uniqueAVS),
      },
    };
  }

  private async calculateSelectionTimingScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const memberships =
      await this.dataService.getOperatorSetMemberships(operatorAddress);

    if (memberships.length === 0) {
      return {
        score: 0,
        confidence: 0,
        metadata: { reason: 'No service participation' },
      };
    }

    let totalScore = 0;
    let validMemberships = 0;

    for (const membership of memberships) {
      const operatorSetCreatedAt = parseInt(membership.operatorSet.createdAt);
      const joinedAt = parseInt(membership.joinedAt);
      const joinDelay = joinedAt - operatorSetCreatedAt;
      const delayDays = joinDelay / (24 * 60 * 60);

      let timingScore = 0;
      if (delayDays < 7) {
        timingScore = 25; // Early adopter (higher risk)
      } else if (delayDays < 30) {
        timingScore = 50; // Quick adopter
      } else if (delayDays < 90) {
        timingScore = 75; // Cautious adopter
      } else {
        timingScore = 100; // Conservative adopter (best)
      }

      totalScore += timingScore;
      validMemberships++;
    }

    const avgScore = validMemberships > 0 ? totalScore / validMemberships : 0;

    return {
      score: avgScore,
      confidence: validMemberships >= 3 ? 80 : 60,
      metadata: {
        avgJoinDelay:
          memberships.reduce((sum, m) => {
            const delay =
              parseInt(m.joinedAt) - parseInt(m.operatorSet.createdAt);
            return sum + delay / (24 * 60 * 60);
          }, 0) / memberships.length,
        membershipCount: validMemberships,
      },
    };
  }

  private async calculatePortfolioRiskScore(
    operatorAddress: string,
  ): Promise<RiskResult> {
    const allocationEvents =
      await this.dataService.getOperatorAllocationEvents(operatorAddress);

    if (allocationEvents.length === 0) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'No allocation data' },
      };
    }

    // Get latest allocations by operator set
    const currentAllocations = new Map<string, number>();
    const avsSet = new Set<string>();

    for (const event of allocationEvents) {
      const key = event.operatorSet.id;
      const magnitude = parseFloat(event.magnitude);
      currentAllocations.set(key, magnitude);

      // Extract AVS from operator set (assuming format: avs-operatorSetId)
      const avsId = event.operatorSet.id.split('-')[0];
      avsSet.add(avsId);
    }

    const weights = Array.from(currentAllocations.values());
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (totalWeight === 0) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'No active allocations' },
      };
    }

    // Normalize weights
    const normalizedWeights = weights.map((w) => w / totalWeight);
    const avsAddresses = Array.from(avsSet);

    // Get correlation matrix and risk scores for portfolio calculation
    const correlationMatrix =
      await this.correlationService.getCorrelationMatrix(avsAddresses);

    // Simplified risk scores (would normally come from AVS risk service)
    const risks = avsAddresses.map(() => 0.2); // 20% base risk assumption

    try {
      const portfolioVariance = this.mathUtils.calculatePortfolioVariance(
        normalizedWeights,
        risks,
        correlationMatrix,
      );

      const portfolioRisk = Math.sqrt(portfolioVariance);
      const score = Math.max(0, 100 - portfolioRisk * 100);

      // Check for concentration risk
      const maxAllocation = Math.max(...normalizedWeights);
      let concentrationPenalty = 0;
      if (maxAllocation > 0.7) {
        concentrationPenalty = 25;
      } else if (maxAllocation > 0.5) {
        concentrationPenalty = 10;
      }

      return {
        score: Math.max(0, score - concentrationPenalty),
        confidence: 75,
        metadata: {
          portfolioRisk,
          maxAllocation,
          serviceCount: avsAddresses.length,
          totalAllocatedMagnitude: totalWeight,
        },
      };
    } catch (error) {
      this.logger.warn(
        `Portfolio risk calculation failed for ${operatorAddress}: ${error.message}`,
        'OperatorAVSSelectionBehaviorService',
      );

      // Fallback to simple concentration analysis
      const maxAllocation = Math.max(...normalizedWeights);
      const score = maxAllocation > 0.7 ? 25 : maxAllocation > 0.5 ? 50 : 75;

      return {
        score,
        confidence: 40,
        metadata: {
          fallbackMethod: true,
          maxAllocation,
          serviceCount: avsAddresses.length,
        },
      };
    }
  }
}
