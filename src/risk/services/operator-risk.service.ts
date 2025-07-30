import { Injectable } from '@nestjs/common';
import { OperatorRiskResult } from 'src/common/interfaces/risk.interfaces';
import { OperatorAVSSelectionBehaviorService } from './operator/avs-selection-behavior.service';
import { OperatorEconomicBehaviorService } from './operator/economic-behavior.service';
import { OperatorNetworkPositionService } from './operator/network-position.service';
import { OperatorOnChainPerformanceService } from './operator/onchain-performance.service';
import { LoggerService } from 'src/common/logger.service';

@Injectable()
export class OperatorRiskService {
  constructor(
    private readonly onChainService: OperatorOnChainPerformanceService,
    private readonly economicService: OperatorEconomicBehaviorService,
    private readonly avsSelectionService: OperatorAVSSelectionBehaviorService,
    private readonly networkService: OperatorNetworkPositionService,
    private readonly logger: LoggerService,
  ) {}

  async calculateOperatorRisk(
    operatorAddress: string,
  ): Promise<OperatorRiskResult> {
    try {
      this.logger.log(
        `Calculating operator risk for ${operatorAddress}`,
        'OperatorRiskService',
      );

      const [onChain, economic, avsSelection, network] = await Promise.all([
        this.onChainService.calculateOnChainPerformance(operatorAddress),
        this.economicService.calculateEconomicBehavior(operatorAddress),
        this.avsSelectionService.calculateAVSSelectionBehavior(operatorAddress),
        this.networkService.calculateNetworkPosition(operatorAddress),
      ]);

      // Apply methodology weights: 40%, 30%, 20%, 10%
      const overallRiskScore =
        onChain.score * 0.4 +
        economic.score * 0.3 +
        avsSelection.score * 0.2 +
        network.score * 0.1;

      // Overall confidence is the minimum of all components
      const confidence = Math.min(
        onChain.confidence,
        economic.confidence,
        avsSelection.confidence,
        network.confidence,
      );

      const result: OperatorRiskResult = {
        overallRiskScore: Math.round(overallRiskScore * 100) / 100,
        components: {
          onChainPerformance: onChain,
          economicBehavior: economic,
          avsSelectionBehavior: avsSelection,
          networkPosition: network,
        },
        confidence: Math.round(confidence * 100) / 100,
        calculatedAt: new Date(),
      };

      this.logger.log(
        `Operator risk calculated for ${operatorAddress}: ${result.overallRiskScore} (confidence: ${result.confidence}%)`,
        'OperatorRiskService',
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to calculate operator risk for ${operatorAddress}: ${error.message}`,
        error.stack,
        'OperatorRiskService',
      );

      // Return minimal result on error
      return {
        overallRiskScore: 0,
        components: {
          onChainPerformance: { score: 0, confidence: 0 },
          economicBehavior: { score: 0, confidence: 0 },
          avsSelectionBehavior: { score: 0, confidence: 0 },
          networkPosition: { score: 0, confidence: 0 },
        },
        confidence: 0,
        calculatedAt: new Date(),
      };
    }
  }

  async calculateMultipleOperatorRisks(
    operatorAddresses: string[],
  ): Promise<Map<string, OperatorRiskResult>> {
    const results = new Map<string, OperatorRiskResult>();

    // Process in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < operatorAddresses.length; i += batchSize) {
      const batch = operatorAddresses.slice(i, i + batchSize);

      const batchPromises = batch.map(async (address) => {
        try {
          const result = await this.calculateOperatorRisk(address);
          return { address, result };
        } catch (error) {
          this.logger.warn(
            `Failed to calculate risk for operator ${address}: ${error.message}`,
            'OperatorRiskService',
          );
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const item of batchResults) {
        if (item) {
          results.set(item.address, item.result);
        }
      }

      // Small delay between batches to prevent rate limiting
      if (i + batchSize < operatorAddresses.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}
