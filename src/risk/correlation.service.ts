import { Injectable, LoggerService } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';

//   TODO: Review this again
@Injectable()
export class CorrelationService {
  constructor(
    private readonly dataService: DataService,
    private readonly logger: LoggerService,
  ) {}

  async getCorrelationMatrix(avsAddresses: string[]): Promise<number[][]> {
    const size = avsAddresses.length;
    const matrix: number[][] = Array(size)
      .fill(null)
      .map(() => Array(size).fill(0));

    // Diagonal elements = 1 (perfect self-correlation)
    for (let i = 0; i < size; i++) {
      matrix[i][i] = 1.0;
    }

    // Calculate correlations for each pair
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const correlation = await this.calculateAVSCorrelation(
          avsAddresses[i],
          avsAddresses[j],
        );
        matrix[i][j] = correlation;
        matrix[j][i] = correlation; // Symmetric matrix
      }
    }

    return matrix;
  }

  private async calculateAVSCorrelation(
    avsA: string,
    avsB: string,
  ): Promise<number> {
    try {
      const [eventCorrelation, operatorCorrelation, technicalCorrelation] =
        await Promise.all([
          this.calculateEventBasedCorrelation(avsA, avsB),
          this.calculateOperatorOverlapCorrelation(avsA, avsB),
          this.calculateTechnicalSimilarityCorrelation(avsA, avsB),
        ]);

      // Weighted combination: events (40%), operator overlap (40%), technical (20%)
      return (
        eventCorrelation * 0.4 +
        operatorCorrelation * 0.4 +
        technicalCorrelation * 0.2
      );
    } catch (error) {
      this.logger.warn(
        `Failed to calculate correlation between ${avsA} and ${avsB}: ${error.message}`,
        'CorrelationService',
      );
      return 0.2; // Default moderate correlation
    }
  }

  private async calculateEventBasedCorrelation(
    avsA: string,
    avsB: string,
  ): Promise<number> {
    const [eventsA, eventsB] = await Promise.all([
      this.dataService.getAVSSlashingEvents(avsA),
      this.dataService.getAVSSlashingEvents(avsB),
    ]);

    if (eventsA.length === 0 || eventsB.length === 0) {
      return 0.1; // Low correlation if no events
    }

    // Count simultaneous events (within 48 hours)
    const timeWindow = 48 * 60 * 60; // 48 hours in seconds
    let simultaneousEvents = 0;

    for (const eventA of eventsA) {
      const timestampA = parseInt(eventA.blockTimestamp);

      for (const eventB of eventsB) {
        const timestampB = parseInt(eventB.blockTimestamp);

        if (Math.abs(timestampA - timestampB) <= timeWindow) {
          simultaneousEvents++;
          break; // Count each event A only once
        }
      }
    }

    return simultaneousEvents / Math.max(eventsA.length, eventsB.length);
  }

  private async calculateOperatorOverlapCorrelation(
    avsA: string,
    avsB: string,
  ): Promise<number> {
    const [adoptionA, adoptionB] = await Promise.all([
      this.dataService.getAVSOperatorAdoption(avsA),
      this.dataService.getAVSOperatorAdoption(avsB),
    ]);

    const operatorsA = new Set(adoptionA.map((a) => a.operator.id));
    const operatorsB = new Set(adoptionB.map((a) => a.operator.id));

    if (operatorsA.size === 0 || operatorsB.size === 0) {
      return 0.1; // Low correlation if no operators
    }

    // Calculate Jaccard similarity (intersection / union)
    const intersection = new Set(
      [...operatorsA].filter((op) => operatorsB.has(op)),
    );
    const union = new Set([...operatorsA, ...operatorsB]);

    return intersection.size / union.size;
  }

  //   TODO: Review this again
  private calculateTechnicalSimilarityCorrelation(
    avsA: string,
    avsB: string,
  ): Promise<number> {
    // Technical similarity based on service categories
    // This would typically be enhanced with metadata analysis

    // For now, return category-based correlations
    const categoryA = this.inferAVSCategory(avsA);
    const categoryB = this.inferAVSCategory(avsB);

    const correlationMap: Record<string, Record<string, number>> = {
      oracle: {
        oracle: 0.7,
        bridge: 0.4,
        data: 0.2,
        coprocessor: 0.45,
        automation: 0.3,
      },
      bridge: {
        oracle: 0.4,
        bridge: 0.8,
        data: 0.3,
        coprocessor: 0.35,
        automation: 0.25,
      },
      data: {
        oracle: 0.2,
        bridge: 0.3,
        data: 0.75,
        coprocessor: 0.2,
        automation: 0.65,
      },
      coprocessor: {
        oracle: 0.45,
        bridge: 0.35,
        data: 0.2,
        coprocessor: 0.7,
        automation: 0.4,
      },
      automation: {
        oracle: 0.3,
        bridge: 0.25,
        data: 0.65,
        coprocessor: 0.4,
        automation: 0.65,
      },
    };

    return Promise.resolve(correlationMap[categoryA]?.[categoryB] || 0.2);
  }

  private inferAVSCategory(avsAddress: string): string {
    // Simple heuristic - in production this would use metadata
    const addr = avsAddress.toLowerCase();

    if (addr.includes('oracle') || addr.includes('feed')) return 'oracle';
    if (addr.includes('bridge') || addr.includes('cross')) return 'bridge';
    if (addr.includes('data') || addr.includes('da')) return 'data';
    if (addr.includes('processor') || addr.includes('zk')) return 'coprocessor';
    if (addr.includes('auto') || addr.includes('keeper')) return 'automation';

    return 'data'; // Default category
  }
}
