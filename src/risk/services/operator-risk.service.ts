import { Injectable, NotFoundException } from '@nestjs/common';
import {
  concentration_metrics,
  operator_analytics,
  volatility_metrics,
} from 'generated/prisma';
import { prisma } from 'src/common/data/prisma';
import { LoggerService } from 'src/common/logger.service';
import {
  GetOperatorResponse,
  GetOperatorsQueryDto,
  GetOperatorsResponse,
  OperatorConcentrationData,
  OperatorRiskData,
  OperatorVolatilityData,
  PaginationMeta,
  RiskLevel,
  SortField,
  SortOrder,
} from 'src/common/types/risk.types';

@Injectable()
export class OperatorRiskService {
  constructor(private readonly logger: LoggerService) {}

  async getOperators(
    query: GetOperatorsQueryDto,
  ): Promise<GetOperatorsResponse> {
    try {
      this.logger.log('Fetching operators list', 'OperatorRiskService');

      const {
        page = 1,
        per_page = 50,
        sort = SortField.RISK_SCORE,
        order = SortOrder.DESC,
      } = query;
      const skip = (Number(page) - 1) * Number(per_page);

      // Get total count
      const totalCount = await prisma.operator_analytics.count();

      // Get paginated data
      const operators = await prisma.operator_analytics.findMany({
        skip,
        take: Number(per_page),
        orderBy: {
          [sort]: order,
        },
      });

      const totalPages = Math.ceil(totalCount / per_page);

      const pagination: PaginationMeta = {
        current_page: page,
        per_page,
        total_pages: totalPages,
        total_count: totalCount,
        has_next: page < totalPages,
        has_prev: page > 1,
      };

      const mappedOperators = operators.map(this.mapAnalyticsToRiskData);

      this.logger.log(
        `Retrieved ${operators.length} operators (page ${page})`,
        'OperatorRiskService',
      );

      return {
        operators: mappedOperators,
        pagination,
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch operators: ${error.message}`,
        error.stack,
        'OperatorRiskService',
      );
      throw error;
    }
  }

  async getOperatorById(operatorId: string): Promise<GetOperatorResponse> {
    try {
      this.logger.log(
        `Fetching operator details for ${operatorId}`,
        'OperatorRiskService',
      );

      const operator = await prisma.operator_analytics.findFirst({
        where: {
          operator_id: operatorId,
          // date: await this.getLatestDateForOperator(operatorId), //TODO: re-enable date filtering if needed
        },
      });

      if (!operator) {
        throw new NotFoundException(`Operator ${operatorId} not found`);
      }

      this.logger.log(
        `Retrieved operator details for ${operatorId}`,
        'OperatorRiskService',
      );

      return this.mapAnalyticsToRiskData(operator);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Failed to fetch operator ${operatorId}: ${error.message}`,
        error.stack,
        'OperatorRiskService',
      );
      throw error;
    }
  }

  async getOperatorVolatility(
    operatorId: string,
  ): Promise<OperatorVolatilityData> {
    try {
      this.logger.log(
        `Fetching volatility for operator ${operatorId}`,
        'OperatorRiskService',
      );

      const volatility = await prisma.volatility_metrics.findFirst({
        where: {
          entity_id: operatorId,
          entity_type: 'operator',
        },
        orderBy: {
          date: 'desc',
        },
      });

      if (!volatility) {
        throw new NotFoundException(
          `Volatility data for operator ${operatorId} not found`,
        );
      }

      const result = this.mapVolatilityToData(volatility);

      this.logger.log(
        `Retrieved volatility data for operator ${operatorId}`,
        'OperatorRiskService',
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Failed to fetch volatility for operator ${operatorId}: ${error.message}`,
        error.stack,
        'OperatorRiskService',
      );
      throw error;
    }
  }

  async getOperatorConcentration(
    operatorId: string,
  ): Promise<OperatorConcentrationData> {
    try {
      this.logger.log(
        `Fetching concentration for operator ${operatorId}`,
        'OperatorRiskService',
      );

      const concentration = await prisma.concentration_metrics.findFirst({
        where: {
          entity_id: operatorId,
          entity_type: 'operator',
        },
        orderBy: {
          date: 'desc',
        },
      });

      if (!concentration) {
        throw new NotFoundException(
          `Concentration data for operator ${operatorId} not found`,
        );
      }

      const result = this.mapConcentrationToData(concentration);

      this.logger.log(
        `Retrieved concentration data for operator ${operatorId}`,
        'OperatorRiskService',
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(
        `Failed to fetch concentration for operator ${operatorId}: ${error.message}`,
        error.stack,
        'OperatorRiskService',
      );
      throw error;
    }
  }

  private mapAnalyticsToRiskData(entity: operator_analytics): OperatorRiskData {
    return {
      operator_id: entity.operator_id,
      risk_score: Number(entity.risk_score),
      risk_level: entity.risk_level as RiskLevel,
      confidence_score: Number(entity.confidence_score),
      performance_score: Number(entity.performance_score) || 0,
      economic_score: Number(entity.economic_score) || 0,
      network_position_score: Number(entity.network_position_score) || 0,
      total_stake: (entity.snapshot_total_delegated_shares || 0).toString(),
      delegator_count: Number(entity.snapshot_delegator_count) || 0,
      avs_count: Number(entity.snapshot_avs_count) || 0,
      slashing_events: Number(entity.slashing_event_count) || 0,
      operational_days: Number(entity.operational_days) || 0,
      is_active: entity.is_active,
      has_sufficient_data: entity.has_sufficient_data,
      delegation_hhi: Number(entity.delegation_hhi) || 0,
      delegation_volatility_30d: Number(entity.delegation_volatility_30d) || 0,
      last_updated: entity.calculated_at,
    };
  }

  private mapVolatilityToData(
    entity: volatility_metrics,
  ): OperatorVolatilityData {
    return {
      operator_id: entity.entity_id,
      volatility_7d: Number(entity.volatility_7d),
      volatility_30d: Number(entity.volatility_30d),
      volatility_90d: Number(entity.volatility_90d),
      coefficient_of_variation: Number(entity.coefficient_of_variation),
      // last_updated: entity.date,
    };
  }

  private mapConcentrationToData(
    entity: concentration_metrics,
  ): OperatorConcentrationData {
    return {
      operator_id: entity.entity_id,
      hhi_value: Number(entity.hhi_value),
      top_1_percentage: Number(entity.top_1_percentage),
      top_5_percentage: Number(entity.top_5_percentage),
      total_entities: Number(entity.total_entities),
      effective_entities: Number(entity.effective_entities),
      // last_updated: entity.date,
    };
  }
}
