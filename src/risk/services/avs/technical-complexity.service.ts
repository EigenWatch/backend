import { Injectable } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { LoggerService } from 'src/common/logger.service';

@Injectable()
export class AVSTechnicalComplexityService {
  constructor(
    private readonly dataService: DataService,
    private readonly logger: LoggerService,
  ) {}

  async calculateTechnicalComplexity(avsAddress: string): Promise<RiskResult> {
    try {
      const [categoryScore] = await Promise.all([
        this.calculateServiceCategoryRisk(avsAddress),
        // TODO: Update when we get other ways of Analyzing AVS Technical Complexity
      ]);

      // Weighted combination: category (100%)
      const finalScore = categoryScore.score * 1;

      const confidence = categoryScore.confidence - 20; // Because we are only checking this using one method

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          categoryRisk: categoryScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating technical complexity for AVS ${avsAddress}: ${error.message}`,
        error.stack,
        'AVSTechnicalComplexityService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateServiceCategoryRisk(
    avsAddress: string,
  ): Promise<RiskResult> {
    // Infer service category from AVS metadata or address patterns
    // TODO: Replace or enhance this with 1inch API call for metadata
    const category = await this.inferAVSCategory(avsAddress);

    // Risk scores based on methodology
    const categoryRiskMap: Record<
      string,
      { score: number; description: string }
    > = {
      data_availability: {
        score: 75,
        description:
          'Lower risk, proven use case with redundancy and erasure coding',
      },
      automation: {
        score: 65,
        description:
          'Medium risk, simpler operations with conservative execution parameters',
      },
      coprocessor: {
        score: 45,
        description:
          'High risk, emerging technology with cryptographic assumptions',
      },
      oracle: {
        score: 40,
        description:
          'High risk, complex consensus with data manipulation concerns',
      },
      bridge: {
        score: 35,
        description:
          'Very high risk, historical vulnerabilities in cross-chain operations',
      },
      unknown: {
        score: 50,
        description: 'Unknown category, moderate risk assumption',
      },
    };

    const riskData = categoryRiskMap[category] || categoryRiskMap['unknown'];

    return {
      score: riskData.score,
      confidence: category !== 'unknown' ? 80 : 40,
      metadata: {
        detectedCategory: category,
        riskDescription: riskData.description,
        riskFactors: this.getCategoryRiskFactors(category),
        mitigationMethods: this.getCategoryMitigations(category),
      },
    };
  }

  private async inferAVSCategory(avsAddress: string): Promise<string> {
    // Try to get category from metadata first
    const avsInfo = await this.dataService.getAVSInfo(avsAddress);

    // Simple heuristic-based categorization (in production, use metadata)
    const addr = avsAddress.toLowerCase();

    if (
      addr.includes('data') ||
      addr.includes('da') ||
      addr.includes('availability')
    ) {
      return 'data_availability';
    }
    if (
      addr.includes('oracle') ||
      addr.includes('feed') ||
      addr.includes('price')
    ) {
      return 'oracle';
    }
    if (
      addr.includes('bridge') ||
      addr.includes('cross') ||
      addr.includes('relay')
    ) {
      return 'bridge';
    }
    if (
      addr.includes('processor') ||
      addr.includes('zk') ||
      addr.includes('compute')
    ) {
      return 'coprocessor';
    }
    if (
      addr.includes('auto') ||
      addr.includes('keeper') ||
      addr.includes('scheduler')
    ) {
      return 'automation';
    }

    return 'unknown';
  }

  private getCategoryRiskFactors(category: string): string[] {
    const riskFactorMap: Record<string, string[]> = {
      data_availability: [
        'Storage failures',
        'Availability challenges',
        'Network partitions',
      ],
      oracle: [
        'Data manipulation',
        'Consensus failures',
        'External data source reliability',
      ],
      bridge: [
        'Bridge hacks',
        'Validation failures',
        'Cross-chain consensus issues',
      ],
      coprocessor: [
        'Cryptographic assumptions',
        'Implementation bugs',
        'Proof generation failures',
      ],
      automation: [
        'Logic errors',
        'Timing failures',
        'External dependency failures',
      ],
      unknown: ['Unknown risk vectors', 'Uncharacterized failure modes'],
    };

    return riskFactorMap[category] || riskFactorMap['unknown'];
  }

  private getCategoryMitigations(category: string): string[] {
    const mitigationMap: Record<string, string[]> = {
      data_availability: [
        'Redundancy',
        'Erasure coding',
        'Multiple storage providers',
      ],
      oracle: [
        'Multiple data sources',
        'Aggregation methods',
        'Outlier detection',
      ],
      bridge: [
        'Extended challenge periods',
        'Multi-sig controls',
        'Economic security',
      ],
      coprocessor: [
        'Formal verification',
        'Extensive testing',
        'Gradual rollout',
      ],
      automation: [
        'Conservative parameters',
        'Fallback mechanisms',
        'Rate limiting',
      ],
      unknown: [
        'General best practices',
        'Conservative approach',
        'Monitoring',
      ],
    };

    return mitigationMap[category] || mitigationMap['unknown'];
  }
}
