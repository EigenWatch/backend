import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger.service';

@Injectable()
export class MathUtilsService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Calculate Herfindahl-Hirschman Index for concentration risk
   */
  calculateHHI(shares: number[]): number {
    if (!shares || shares.length === 0) return 0;

    const total = shares.reduce((sum, share) => sum + share, 0);
    if (total === 0) return 0;

    const normalizedShares = shares.map((share) => share / total);
    return normalizedShares.reduce((hhi, share) => hhi + share * share, 0);
  }

  /**
   * Calculate standard deviation with consistent methodology
   */
  calculateStandardDeviation(values: number[]): number {
    if (!values || values.length === 0) return 0;
    if (values.length === 1) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance =
      values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
      values.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate coefficient of variation (normalized volatility)
   */
  calculateCoefficientOfVariation(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    if (mean === 0) return 0;

    const stdDev = this.calculateStandardDeviation(values);
    return stdDev / Math.abs(mean);
  }

  /**
   * Apply exponential decay weighting to historical events
   */
  applyExponentialDecay(eventTimes: number[], lambda: number = 0.1): number[] {
    const currentTime = Math.floor(Date.now() / 1000);

    return eventTimes.map((eventTime) => {
      const daysSince = (currentTime - eventTime) / (24 * 60 * 60);
      return Math.exp(-lambda * daysSince);
    });
  }

  /**
   * Calculate portfolio variance using Markowitz model
   */
  calculatePortfolioVariance(
    weights: number[],
    risks: number[],
    correlationMatrix: number[][],
  ): number {
    if (
      weights.length !== risks.length ||
      weights.length !== correlationMatrix.length
    ) {
      throw new Error('Dimension mismatch in portfolio variance calculation');
    }

    let variance = 0;

    // Individual risk contributions
    for (let i = 0; i < weights.length; i++) {
      variance += weights[i] * weights[i] * risks[i] * risks[i];
    }

    // Correlation contributions
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        if (i !== j) {
          variance +=
            weights[i] *
            weights[j] *
            risks[i] *
            risks[j] *
            correlationMatrix[i][j];
        }
      }
    }

    return variance;
  }

  /**
   * Calculate time-weighted score with exponential decay
   */
  calculateTimeWeightedScore(
    events: { score: number; timestamp: number }[],
    lambda: number = 0.1,
  ): number {
    if (!events || events.length === 0) return 0;

    const currentTime = Math.floor(Date.now() / 1000);
    let weightedSum = 0;
    let totalWeight = 0;

    for (const event of events) {
      const daysSince = (currentTime - event.timestamp) / (24 * 60 * 60);
      const weight = Math.exp(-lambda * daysSince);

      weightedSum += event.score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate growth rate between two values over time period
   */
  calculateGrowthRate(
    initialValue: number,
    finalValue: number,
    timePeriod: number,
  ): number {
    if (initialValue <= 0 || timePeriod <= 0) return 0;
    return Math.pow(finalValue / initialValue, 1 / timePeriod) - 1;
  }

  /**
   * Calculate percentile rank of value in dataset
   */
  calculatePercentileRank(value: number, dataset: number[]): number {
    if (!dataset || dataset.length === 0) return 0;

    const sortedData = [...dataset].sort((a, b) => a - b);
    const rank = sortedData.filter((x) => x <= value).length;
    return (rank / sortedData.length) * 100;
  }

  /**
   * Calculate confidence score based on data availability
   */
  calculateConfidenceScore(
    dataPoints: number,
    timeSpan: number,
    hasSlashingData: boolean = false,
    hasRecentActivity: boolean = false,
  ): number {
    let confidence = 50; // Base confidence

    // Data points contribution
    if (dataPoints >= 100) confidence += 20;
    else if (dataPoints >= 50) confidence += 15;
    else if (dataPoints >= 20) confidence += 10;
    else if (dataPoints >= 10) confidence += 5;

    // Time span contribution (in days)
    if (timeSpan >= 90) confidence += 15;
    else if (timeSpan >= 30) confidence += 10;
    else if (timeSpan >= 7) confidence += 5;

    // Data quality bonuses
    if (hasSlashingData) confidence += 10;
    if (hasRecentActivity) confidence += 5;

    return Math.min(confidence, 95); // Cap at 95%
  }
}
