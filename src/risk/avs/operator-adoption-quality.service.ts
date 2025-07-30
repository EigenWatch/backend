import { Injectable, LoggerService } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

@Injectable()
export class AVSOperatorAdoptionQualityService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly operatorRiskService: OperatorRiskService,
    private readonly logger: LoggerService,
  ) {}

  async calculateOperatorAdoptionQuality(
    avsAddress: string,
  ): Promise<RiskResult> {
    try {
      const [qualityScore, growthScore, retentionScore] = await Promise.all([
        this.calculateOperatorQualityAggregation(avsAddress),
        this.calculateAdoptionGrowthPattern(avsAddress),
        this.calculateOperatorRetention(avsAddress),
      ]);

      // Weighted combination: quality (50%), growth (30%), retention (20%)
      const finalScore =
        qualityScore.score * 0.5 +
        growthScore.score * 0.3 +
        retentionScore.score * 0.2;

      const confidence = Math.min(
        qualityScore.confidence,
        growthScore.confidence,
        retentionScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          operatorQuality: qualityScore.metadata,
          growthPattern: growthScore.metadata,
          retention: retentionScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating operator adoption quality for AVS ${avsAddress}: ${error.message}`,
        error.stack,
        'AVSOperatorAdoptionQualityService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateOperatorQualityAggregation(
    avsAddress: string,
  ): Promise<RiskResult> {
    const adoption = await this.dataService.getAVSOperatorAdoption(avsAddress);
    const activeOperators = adoption.filter((a) => a.isActive);

    if (activeOperators.length === 0) {
      return {
        score: 0,
        confidence: 0,
        metadata: { reason: 'No active operators' },
      };
    }

    // Calculate risk scores for participating operators
    const operatorAddresses = activeOperators.map((a) => a.operator.id);
    const operatorRisks =
      await this.operatorRiskService.calculateMultipleOperatorRisks(
        operatorAddresses,
      );

    // Calculate weighted average based on stake allocation (simplified - using equal weights for now)
    let totalScore = 0;
    let validOperators = 0;

    for (const [address, riskResult] of operatorRisks) {
      if (riskResult.overallRiskScore > 0) {
        totalScore += riskResult.overallRiskScore;
        validOperators++;
      }
    }

    if (validOperators === 0) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'No valid operator risk scores' },
      };
    }

    const avgOperatorScore = totalScore / validOperators;
    let qualityScore = 0;

    // Score based on average operator quality
    if (avgOperatorScore > 80) {
      qualityScore = 90; // High-quality adoption
    } else if (avgOperatorScore > 60) {
      qualityScore = 70; // Good adoption
    } else if (avgOperatorScore > 40) {
      qualityScore = 50; // Mixed adoption
    } else {
      qualityScore = 25; // Low-quality adoption
    }

    return {
      score: qualityScore,
      confidence: validOperators >= 5 ? 85 : 60,
      metadata: {
        avgOperatorScore,
        totalOperators: activeOperators.length,
        validOperators,
        operatorScoreDistribution: {
          high: Array.from(operatorRisks.values()).filter(
            (r) => (r as any).overallRiskScore > 80,
          ).length,
          medium: Array.from(operatorRisks.values()).filter(
            (r) =>
              (r as any).overallRiskScore >= 60 &&
              (r as any).overallRiskScore <= 80,
          ).length,
          low: Array.from(operatorRisks.values()).filter(
            (r) => (r as any).overallRiskScore < 60,
          ).length,
        },
      },
    };
  }

  private async calculateAdoptionGrowthPattern(
    avsAddress: string,
  ): Promise<RiskResult> {
    const adoption = await this.dataService.getAVSOperatorAdoption(avsAddress);
    const avsInfo = await this.dataService.getAVSInfo(avsAddress);

    if (!avsInfo?.createdAt || adoption.length === 0) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'Insufficient adoption data' },
      };
    }

    // Group adoptions by month
    const monthlyAdoptions = new Map<string, number>();

    for (const adopt of adoption) {
      const monthKey = new Date(parseInt(adopt.joinedAt) * 1000)
        .toISOString()
        .slice(0, 7);
      monthlyAdoptions.set(monthKey, (monthlyAdoptions.get(monthKey) || 0) + 1);
    }

    const monthlyValues = Array.from(monthlyAdoptions.values());

    if (monthlyValues.length < 3) {
      return {
        score: 60,
        confidence: 40,
        metadata: {
          reason: 'Too few months of data',
          monthsOfData: monthlyValues.length,
        },
      };
    }

    // Calculate growth rate and volatility
    const growthRates: number[] = [];
    for (let i = 1; i < monthlyValues.length; i++) {
      const prevValue = monthlyValues[i - 1];
      const currValue = monthlyValues[i];
      if (prevValue > 0) {
        growthRates.push((currValue - prevValue) / prevValue);
      }
    }

    const avgGrowthRate =
      growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
    const growthVolatility =
      this.mathUtils.calculateStandardDeviation(growthRates);

    let score = 50; // Base score

    // Assess growth pattern sustainability
    if (avgGrowthRate > 0.1 && avgGrowthRate < 0.5 && growthVolatility < 0.3) {
      score = 90; // Healthy, steady growth
    } else if (avgGrowthRate > 0 && growthVolatility < 0.5) {
      score = 75; // Positive growth with manageable volatility
    } else if (avgGrowthRate > 0) {
      score = 60; // Positive but volatile growth
    } else if (avgGrowthRate > -0.1) {
      score = 40; // Stagnant
    } else {
      score = 20; // Declining
    }

    return {
      score,
      confidence: 75,
      metadata: {
        avgGrowthRate,
        growthVolatility,
        monthsOfData: monthlyValues.length,
        totalOperators: adoption.length,
        currentMonthlyRate: monthlyValues[monthlyValues.length - 1],
        trendDirection:
          avgGrowthRate > 0.05
            ? 'growing'
            : avgGrowthRate < -0.05
              ? 'declining'
              : 'stable',
      },
    };
  }

  private async calculateOperatorRetention(
    avsAddress: string,
  ): Promise<RiskResult> {
    const adoption = await this.dataService.getAVSOperatorAdoption(avsAddress);

    if (adoption.length === 0) {
      return {
        score: 0,
        confidence: 0,
        metadata: { reason: 'No operator adoption data' },
      };
    }

    // Calculate monthly churn rates
    const currentTime = Math.floor(Date.now() / 1000);
    const monthlyChurnData = new Map<string, { total: number; left: number }>();

    for (const adopt of adoption) {
      const joinMonth = new Date(parseInt(adopt.joinedAt) * 1000)
        .toISOString()
        .slice(0, 7);

      if (!monthlyChurnData.has(joinMonth)) {
        monthlyChurnData.set(joinMonth, { total: 0, left: 0 });
      }

      const data = monthlyChurnData.get(joinMonth)!;
      data.total++;

      if (adopt.leftAt && parseInt(adopt.leftAt) > 0) {
        data.left++;
      }
    }

    // Calculate average churn rate
    const churnRates: number[] = [];
    for (const [month, data] of monthlyChurnData) {
      if (data.total > 0) {
        churnRates.push(data.left / data.total);
      }
    }

    if (churnRates.length === 0) {
      return {
        score: 70,
        confidence: 40,
        metadata: { reason: 'No churn data available' },
      };
    }

    const avgChurnRate =
      churnRates.reduce((a, b) => a + b, 0) / churnRates.length;
    let score = 50; // Base score

    // Score based on churn rate
    if (avgChurnRate < 0.05) {
      score = 90; // Excellent retention (<5% monthly churn)
    } else if (avgChurnRate < 0.15) {
      score = 75; // Good retention (5-15% monthly churn)
    } else if (avgChurnRate < 0.3) {
      score = 45; // High turnover (15-30% monthly churn)
    } else {
      score = 20; // Very high turnover (>30% monthly churn)
    }

    const activeOperators = adoption.filter((a) => a.isActive).length;
    const totalOperators = adoption.length;
    const retentionRate =
      totalOperators > 0 ? activeOperators / totalOperators : 0;

    return {
      score,
      confidence: churnRates.length >= 3 ? 80 : 60,
      metadata: {
        avgMonthlyChurnRate: avgChurnRate,
        currentRetentionRate: retentionRate,
        activeOperators,
        totalOperators,
        monthsAnalyzed: churnRates.length,
      },
    };
  }
}
