// src/modules/risk/controllers/risk-assessment.controller.ts

import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  GetOperatorsQueryDto,
  GetOperatorsResponse,
  GetOperatorResponse,
  OperatorParamsDto,
  OperatorVolatilityData,
  OperatorConcentrationData,
} from 'src/common/types/risk.types';
import { OperatorRiskService } from './services/operator-risk.service';

@ApiTags('Risk Assessment')
@Controller('api/risk')
export class RiskAssessmentController {
  constructor(private readonly operatorRiskService: OperatorRiskService) {}

  @Get('operators')
  @ApiOperation({ summary: 'Get all operators with risk data' })
  @ApiResponse({
    status: 200,
    description: 'Operators retrieved successfully',
    // type: GetOperatorsResponse,
  })
  async getOperators(
    @Query() query: GetOperatorsQueryDto,
  ): Promise<GetOperatorsResponse> {
    return this.operatorRiskService.getOperators(query);
  }

  @Get('operators/:operator_id')
  @ApiOperation({ summary: 'Get detailed risk data for a specific operator' })
  @ApiResponse({
    status: 200,
    description: 'Operator risk data retrieved successfully',
    // type: GetOperatorResponse,
  })
  @ApiResponse({ status: 404, description: 'Operator not found' })
  async getOperatorById(
    @Param() params: OperatorParamsDto,
  ): Promise<GetOperatorResponse> {
    return this.operatorRiskService.getOperatorById(params.operator_id);
  }

  @Get('operators/:operator_id/volatility')
  @ApiOperation({ summary: 'Get volatility metrics for an operator' })
  @ApiResponse({
    status: 200,
    description: 'Operator volatility metrics retrieved successfully',
    // type: OperatorVolatilityData,
  })
  @ApiResponse({ status: 404, description: 'Volatility data not found' })
  async getOperatorVolatility(
    @Param() params: OperatorParamsDto,
  ): Promise<OperatorVolatilityData> {
    return this.operatorRiskService.getOperatorVolatility(params.operator_id);
  }

  @Get('operators/:operator_id/concentration')
  @ApiOperation({ summary: 'Get concentration metrics for an operator' })
  @ApiResponse({
    status: 200,
    description: 'Operator concentration metrics retrieved successfully',
    // type: OperatorConcentrationData,
  })
  @ApiResponse({ status: 404, description: 'Concentration data not found' })
  async getOperatorConcentration(
    @Param() params: OperatorParamsDto,
  ): Promise<OperatorConcentrationData> {
    return this.operatorRiskService.getOperatorConcentration(
      params.operator_id,
    );
  }
}
