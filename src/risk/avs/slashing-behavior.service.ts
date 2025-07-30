import { Injectable, LoggerService } from '@nestjs/common';
import { DataService } from 'src/common/data/data.service';
import { RiskResult } from 'src/common/interfaces/risk.interfaces';
import { MathUtilsService } from 'src/common/utils/math-utils.service';

@Injectable()
export class AVSSlashingBehaviorService {
  constructor(
    private readonly dataService: DataService,
    private readonly mathUtils: MathUtilsService,
    private readonly logger: LoggerService,
  ) {}

  async calculateSlashingBehavior(avsAddress: string): Promise<RiskResult> {
    try {
      const [frequencyScore, severityScore, documentationScore] =
        await Promise.all([
          this.calculateSlashingFrequencyScore(avsAddress),
          this.calculateSlashingSeverityScore(avsAddress),
          this.calculateSlashingConditionDocumentationScore(avsAddress),
        ]);

      // Weighted combination: frequency (50%), severity (30%), documentation (20%)
      const finalScore =
        frequencyScore.score * 0.5 +
        severityScore.score * 0.3 +
        documentationScore.score * 0.2;

      const confidence = Math.min(
        frequencyScore.confidence,
        severityScore.confidence,
        documentationScore.confidence,
      );

      return {
        score: Math.max(0, Math.min(100, finalScore)),
        confidence,
        metadata: {
          frequency: frequencyScore.metadata,
          severity: severityScore.metadata,
          documentation: documentationScore.metadata,
        },
      };
    } catch (error) {
      this.logger.error(
        `Error calculating slashing behavior for AVS ${avsAddress}: ${error.message}`,
        error.stack,
        'AVSSlashingBehaviorService',
      );
      return { score: 0, confidence: 0 };
    }
  }

  private async calculateSlashingFrequencyScore(
    avsAddress: string,
  ): Promise<RiskResult> {
    const [slashingEvents, avsInfo] = await Promise.all([
      this.dataService.getAVSSlashingEvents(avsAddress),
      this.dataService.getAVSInfo(avsAddress),
    ]);

    if (!avsInfo?.createdAt) {
      return {
        score: 50,
        confidence: 20,
        metadata: { reason: 'No AVS creation data' },
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const monthsActive =
      (currentTime - parseInt(avsInfo.createdAt)) / (30 * 24 * 60 * 60);

    if (monthsActive < 1) {
      return {
        score: 70,
        confidence: 40,
        metadata: { reason: 'Too new to assess', monthsActive },
      };
    }

    const monthlySlashingRate = slashingEvents.length / monthsActive;
    let score = 50; // Base score

    // Score based on slashing frequency
    if (slashingEvents.length === 0 && monthsActive >= 3) {
      score = 90; // Mature and stable
    } else if (monthlySlashingRate <= 0.5) {
      score = 80; // Reasonable frequency
    } else if (monthlySlashingRate <= 1.0) {
      score = 50; // Neutral
    } else if (monthlySlashingRate <= 2.0) {
      score = 25; // Aggressive
    } else {
      score = 10; // Very aggressive
    }

    return {
      score,
      confidence: monthsActive >= 3 ? 85 : 60,
      metadata: {
        totalSlashings: slashingEvents.length,
        monthsActive,
        monthlySlashingRate,
      },
    };
  }

  private async calculateSlashingSeverityScore(
    avsAddress: string,
  ): Promise<RiskResult> {
    const slashingEvents =
      await this.dataService.getAVSSlashingEvents(avsAddress);

    if (slashingEvents.length === 0) {
      return {
        score: 75,
        confidence: 40,
        metadata: { reason: 'No slashing events to analyze' },
      };
    }

    // Calculate average slash percentage
    let totalSlashPercentage = 0;
    let validEvents = 0;

    for (const event of slashingEvents) {
      if (event.wadSlashed && event.wadSlashed.length > 0) {
        // wadSlashed is in WAD format (18 decimals), convert to percentage
        const slashAmount = parseFloat(event.wadSlashed[0]) / Math.pow(10, 18);
        const slashPercentage = slashAmount * 100; // Convert to percentage

        totalSlashPercentage += slashPercentage;
        validEvents++;
      }
    }

    if (validEvents === 0) {
      return {
        score: 50,
        confidence: 30,
        metadata: { reason: 'No valid slash amounts found' },
      };
    }

    const avgSlashPercentage = totalSlashPercentage / validEvents;
    let score = 50; // Base score

    // Score based on severity
    if (avgSlashPercentage < 5) {
      score = 85; // Reasonable penalties
    } else if (avgSlashPercentage <= 20) {
      score = 50; // Moderate penalties
    } else if (avgSlashPercentage <= 50) {
      score = 25; // Severe penalties
    } else {
      score = 10; // Extreme penalties
    }

    return {
      score,
      confidence: 80,
      metadata: {
        avgSlashPercentage,
        slashingEventCount: validEvents,
        maxSlashPercentage: Math.max(
          ...slashingEvents.map((e) =>
            e.wadSlashed && e.wadSlashed.length > 0
              ? (parseFloat(e.wadSlashed[0]) / Math.pow(10, 18)) * 100
              : 0,
          ),
        ),
      },
    };
  }

  private async calculateSlashingConditionDocumentationScore(
    avsAddress: string,
  ): Promise<RiskResult> {
    const slashingEvents =
      await this.dataService.getAVSSlashingEvents(avsAddress);

    // Analyze description quality in slashing events
    let documentedEvents = 0;
    let vagueDesdriptions = 0;

    for (const event of slashingEvents) {
      if (event.description && event.description.trim().length > 0) {
        documentedEvents++;

        // Simple heuristic for vague descriptions
        const desc = event.description.toLowerCase();
        if (
          desc.includes('violation') ||
          desc.includes('breach') ||
          desc.includes('failure') ||
          desc.includes('malicious')
        ) {
          // These are somewhat objective
        } else if (desc.length < 20 || desc.includes('poor performance')) {
          vagueDesdriptions++;
        }
      }
    }

    let score = 50; // Base score

    if (slashingEvents.length === 0) {
      score = 75; // No slashing means no documentation issues
    } else {
      const documentationRate = documentedEvents / slashingEvents.length;
      const vagueRate = vagueDesdriptions / Math.max(1, documentedEvents);

      if (documentationRate > 0.8 && vagueRate < 0.2) {
        score = 85; // Well documented with clear conditions
      } else if (documentationRate > 0.5) {
        score = 65; // Moderately documented
      } else {
        score = 30; // Poor documentation
      }
    }

    return {
      score,
      confidence: slashingEvents.length >= 3 ? 75 : 50,
      metadata: {
        totalSlashings: slashingEvents.length,
        documentedEvents,
        vagueDesdriptions,
        documentationRate:
          slashingEvents.length > 0
            ? documentedEvents / slashingEvents.length
            : 0,
      },
    };
  }
}
