import { Injectable } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { LoggerService } from 'src/common/logger.service';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

@Injectable()
export class AVSEconomicSustainabilityService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly logger: LoggerService,
  ) {}

  async calculateEconomicSustainability(
    avsAddress: string,
  ): Promise<RiskResult> {
    try {
      const [businessModelScore, revenueScore] = await Promise.all([
        this.calculateBusinessModelViability(avsAddress),
        this.calculateRevenueGeneration(avsAddress),
      ]);

      // Weighted combination: business model (60%), revenue (40%)
      const finalScore =
        businessModelScore.score * 0.6 + revenueScore.score * 0.4;

      const confidence = Math.min(
        businessModelScore.confidence,
        revenueScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          businessModel: businessModelScore.metadata,
          revenueGeneration: revenueScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating economic sustainability for AVS ${avsAddress}: ${error.message}`,
        error.stack,
        'AVSEconomicSustainabilityService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateBusinessModelViability(
    avsAddress: string,
  ): Promise<RiskResult> {
    const rewardsSubmissions =
      await this.dataService.getAVSRewardsSubmissions(avsAddress);

    // Analyze reward submission patterns to infer business model
    const businessModel = this.inferBusinessModel(rewardsSubmissions);

    // Score based on business model sustainability (from methodology)
    const modelScores: Record<string, { score: number; description: string }> =
      {
        service_provider: {
          score: 80,
          description:
            'Users pay ETH fees - proven revenue model with direct value proposition',
        },
        token_mixed: {
          score: 60,
          description:
            'Mixed ETH and native token model - moderate sustainability risk',
        },
        native_token: {
          score: 40,
          description:
            'Native token only - high sustainability risk requiring token ecosystem development',
        },
        dual_staking: {
          score: 50,
          description:
            'ETH + native token security - complex but potentially stable',
        },
        unknown: {
          score: 45,
          description: 'Unknown business model - moderate risk assumption',
        },
      };

    const modelData = modelScores[businessModel] || modelScores['unknown'];

    return {
      score: modelData.score,
      confidence: businessModel !== 'unknown' ? 75 : 40,
      metadata: {
        detectedBusinessModel: businessModel,
        modelDescription: modelData.description,
        revenueStreams: this.identifyRevenueStreams(rewardsSubmissions),
        sustainabilityRisks: this.getBusinessModelRisks(businessModel),
      },
    };
  }

  private async calculateRevenueGeneration(
    avsAddress: string,
  ): Promise<RiskResult> {
    const rewardsSubmissions =
      await this.dataService.getAVSRewardsSubmissions(avsAddress);
    const avsInfo = await this.dataService.getAVSInfo(avsAddress);

    if (rewardsSubmissions.length === 0) {
      const monthsActive = avsInfo?.createdAt
        ? (Date.now() / 1000 - parseInt(avsInfo.createdAt)) /
          (30 * 24 * 60 * 60)
        : 0;

      if (monthsActive > 6) {
        return {
          score: 20,
          confidence: 80,
          metadata: { reason: 'No revenue after 6+ months', monthsActive },
        };
      } else {
        return {
          score: 50,
          confidence: 40,
          metadata: { reason: 'Too early to assess revenue', monthsActive },
        };
      }
    }

    // Analyze revenue trends
    const monthlyRevenues = this.calculateMonthlyRevenues(rewardsSubmissions);
    const revenueMetrics = this.analyzeRevenueMetrics(monthlyRevenues);

    let score = 50; // Base score

    // Score based on revenue performance
    if (revenueMetrics.hasPositiveRevenue) {
      score += 30;
    }

    if (revenueMetrics.growthRate > 0.1) {
      score += 20; // Strong growth (>10% monthly)
    } else if (revenueMetrics.growthRate > 0) {
      score += 10; // Positive growth
    } else if (revenueMetrics.growthRate < -0.1) {
      score -= 20; // Declining revenue
    }

    if (revenueMetrics.consistency > 0.7) {
      score += 10; // Consistent revenue
    } else if (revenueMetrics.consistency < 0.3) {
      score -= 10; // Highly volatile revenue
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      confidence: monthlyRevenues.length >= 3 ? 80 : 50,
      metadata: {
        monthlyRevenues: monthlyRevenues.slice(-6), // Last 6 months
        avgMonthlyRevenue: revenueMetrics.avgRevenue,
        growthRate: revenueMetrics.growthRate,
        consistency: revenueMetrics.consistency,
        totalRevenue: revenueMetrics.totalRevenue,
        revenueStreams: revenueMetrics.revenueStreams,
      },
    };
  }

  private inferBusinessModel(rewardsSubmissions: any[]): string {
    if (rewardsSubmissions.length === 0) return 'unknown';

    // Analyze reward submission patterns and token types
    const ethRewards = rewardsSubmissions.filter(
      (r) =>
        r.token.toLowerCase().includes('eth') ||
        r.token === '0x0000000000000000000000000000000000000000',
    );
    const tokenRewards = rewardsSubmissions.filter(
      (r) => !ethRewards.includes(r),
    );

    const ethRatio = ethRewards.length / rewardsSubmissions.length;

    if (ethRatio > 0.8) {
      return 'service_provider'; // Primarily ETH-based fees
    } else if (ethRatio > 0.4) {
      return 'token_mixed'; // Mixed model
    } else if (tokenRewards.length > 0) {
      return 'native_token'; // Primarily native token
    }

    return 'unknown';
  }

  private identifyRevenueStreams(rewardsSubmissions: any[]): string[] {
    const streams: Set<string> = new Set();

    for (const submission of rewardsSubmissions) {
      if (submission.submissionType === 'AVS_REWARDS') {
        streams.add('Service fees');
      } else if (submission.submissionType === 'OPERATOR_DIRECTED_AVS') {
        streams.add('Performance incentives');
      }

      // Analyze token types
      if (submission.token.toLowerCase().includes('eth')) {
        streams.add('ETH fees');
      } else {
        streams.add('Token rewards');
      }
    }

    return Array.from(streams);
  }

  private getBusinessModelRisks(businessModel: string): string[] {
    const riskMap: Record<string, string[]> = {
      service_provider: ['Fee market competition', 'User adoption challenges'],
      token_mixed: ['Token volatility', 'Mixed incentive alignment'],
      native_token: [
        'Token adoption risk',
        'Circular dependency',
        'Liquidity challenges',
      ],
      dual_staking: ['Implementation complexity', 'Governance challenges'],
      unknown: ['Unclear value capture', 'Uncertain sustainability'],
    };

    return riskMap[businessModel] || riskMap['unknown'];
  }

  private calculateMonthlyRevenues(rewardsSubmissions: any[]): number[] {
    const monthlyTotals = new Map<string, number>();

    for (const submission of rewardsSubmissions) {
      const month = new Date(parseInt(submission.startTimestamp) * 1000)
        .toISOString()
        .slice(0, 7);
      const amount = parseFloat(submission.amount);

      if (!isNaN(amount)) {
        monthlyTotals.set(month, (monthlyTotals.get(month) || 0) + amount);
      }
    }

    return Array.from(monthlyTotals.values()).sort();
  }

  private analyzeRevenueMetrics(monthlyRevenues: number[]): any {
    if (monthlyRevenues.length === 0) {
      return {
        hasPositiveRevenue: false,
        avgRevenue: 0,
        growthRate: 0,
        consistency: 0,
        totalRevenue: 0,
        revenueStreams: 0,
      };
    }

    const totalRevenue = monthlyRevenues.reduce((a, b) => a + b, 0);
    const avgRevenue = totalRevenue / monthlyRevenues.length;

    // Calculate growth rate
    let growthRate = 0;
    if (monthlyRevenues.length > 1) {
      const firstValue = monthlyRevenues[0];
      const lastValue = monthlyRevenues[monthlyRevenues.length - 1];
      if (firstValue > 0) {
        growthRate =
          Math.pow(lastValue / firstValue, 1 / monthlyRevenues.length) - 1;
      }
    }

    // Calculate consistency (inverse of coefficient of variation)
    const consistency =
      avgRevenue > 0
        ? 1 -
          this.mathUtils.calculateStandardDeviation(monthlyRevenues) /
            avgRevenue
        : 0;

    return {
      hasPositiveRevenue: totalRevenue > 0,
      avgRevenue,
      growthRate,
      consistency: Math.max(0, Math.min(1, consistency)),
      totalRevenue,
      revenueStreams: new Set(monthlyRevenues.filter((r) => r > 0)).size,
    };
  }
}
