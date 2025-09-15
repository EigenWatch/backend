import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsString,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// Enums
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum SortField {
  RISK_SCORE = 'risk_score',
  TOTAL_STAKE = 'total_stake',
  DELEGATOR_COUNT = 'delegator_count',
  PERFORMANCE_SCORE = 'performance_score',
  ECONOMIC_SCORE = 'economic_score',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

// DTOs for API requests
export class GetOperatorsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  per_page?: number = 50;

  @ApiPropertyOptional({ enum: SortField, default: SortField.RISK_SCORE })
  @IsOptional()
  @IsEnum(SortField)
  sort?: SortField = SortField.RISK_SCORE;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}

export class OperatorParamsDto {
  @ApiProperty({ description: 'Operator Ethereum address' })
  @IsString()
  operator_id: string;
}

// Response interfaces
export interface OperatorRiskData {
  operator_id: string;
  risk_score: number;
  risk_level: RiskLevel;
  confidence_score: number;
  performance_score: number;
  economic_score: number;
  network_position_score: number;
  total_stake: string; // String to preserve precision
  delegator_count: number;
  avs_count: number;
  slashing_events: number;
  operational_days: number;
  is_active: boolean;
  has_sufficient_data: boolean;
  delegation_hhi: number;
  delegation_volatility_30d: number;
  last_updated: Date | null; // ISO date string
}

export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total_pages: number;
  total_count: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface GetOperatorsResponse {
  operators: OperatorRiskData[];
  pagination: PaginationMeta;
}

export interface GetOperatorResponse extends OperatorRiskData {}

export interface OperatorVolatilityData {
  operator_id: string;
  volatility_7d: number;
  volatility_30d: number;
  volatility_90d: number;
  coefficient_of_variation: number;
  last_updated?: string;
}

export interface OperatorConcentrationData {
  operator_id: string;
  hhi_value: number;
  top_1_percentage: number;
  top_5_percentage: number;
  total_entities: number;
  effective_entities: number;
  last_updated?: string;
}
