import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../logger.service';
import {
  OperatorCommissionEvent,
  OperatorSetMembership,
  DelegationStabilityData,
} from '../interfaces/risk.interfaces';

@Injectable()
export class DataService {
  private readonly subgraphUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
  ) {
    this.subgraphUrl = process.env.EIGENWATCH_SUBGRAPH_URL || '';
  }

  private async querySubgraph(query: string, variables: any): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.subgraphUrl,
          { query, variables },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          },
        ),
      );

      if (response.data.errors) {
        throw new Error(
          `GraphQL errors: ${JSON.stringify(response.data.errors)}`,
        );
      }

      return response.data.data;
    } catch (error) {
      this.logger.error(
        `Subgraph query failed: ${error.message}`,
        error.stack,
        'DataService',
      );
      throw new HttpException(
        'Failed to fetch data from subgraph',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getOperatorSlashingEvents(operatorAddress: string): Promise<any[]> {
    const query = `
      query GetOperatorSlashingEvents($operatorAddress: Bytes!) {
        operatorSlasheds(
          where: { operator_: { address: $operatorAddress } }
          orderBy: blockTimestamp
          orderDirection: desc
        ) {
          id
          transactionHash
          blockTimestamp
          operator { id }
          operatorSet { 
            id 
            avs { id }
          }
          strategies
          wadSlashed
          description
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      operatorAddress: operatorAddress.toLowerCase(),
    });
    return result.operatorSlasheds || [];
  }

  async getOperatorDelegationHistory(
    operatorAddress: string,
    fromTimestamp?: number,
  ): Promise<any[]> {
    const whereClause = fromTimestamp
      ? `{ operator_: { address: $operatorAddress }, blockTimestamp_gte: $fromTimestamp }`
      : `{ operator_: { address: $operatorAddress } }`;

    const query = `
      query GetOperatorShareEvents($operatorAddress: Bytes!, $fromTimestamp: BigInt) {
        operatorShareEvents(
          where: ${whereClause}
          orderBy: blockTimestamp
          orderDirection: asc
          first: 1000
        ) {
          id
          blockTimestamp
          operator { id }
          staker { id }
          strategy { id }
          shares
          eventType
        }
      }
    `;

    const variables = {
      operatorAddress: operatorAddress.toLowerCase(),
      ...(fromTimestamp && { fromTimestamp: fromTimestamp.toString() }),
    };

    const result = await this.querySubgraph(query, variables);
    return result.operatorShareEvents || [];
  }

  async getOperatorCommissionEvents(
    operatorAddress: string,
  ): Promise<OperatorCommissionEvent[]> {
    const query = `
      query GetOperatorCommissionEvents($operatorAddress: Bytes!) {
        operatorCommissionEvents(
          where: { operator_: { address: $operatorAddress } }
          orderBy: blockTimestamp
          orderDirection: desc
        ) {
          id
          operator { id }
          commissionType
          oldCommissionBips
          newCommissionBips
          activatedAt
          blockTimestamp
          targetAVS { id }
          targetOperatorSet { id }
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      operatorAddress: operatorAddress.toLowerCase(),
    });
    return result.operatorCommissionEvents || [];
  }

  async getOperatorSetMemberships(
    operatorAddress: string,
  ): Promise<OperatorSetMembership[]> {
    const query = `
      query GetOperatorSetMemberships($operatorAddress: Bytes!) {
        operatorSetMemberships(
          where: { operator_: { address: $operatorAddress } }
          orderBy: joinedAt
          orderDirection: asc
        ) {
          id
          operator { id }
          operatorSet { 
            id 
            avs { id }
            createdAt
          }
          joinedAt
          leftAt
          isActive
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      operatorAddress: operatorAddress.toLowerCase(),
    });
    return result.operatorSetMemberships || [];
  }

  async getOperatorRegistrationInfo(operatorAddress: string): Promise<any> {
    const query = `
      query GetOperatorRegistration($operatorAddress: Bytes!) {
        operator(id: $operatorAddress) {
          id
          address
          registeredAt
          delegatorCount
          avsRegistrationCount
          operatorSetCount
          slashingEventCount
          lastActivityAt
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      operatorAddress: operatorAddress.toLowerCase(),
    });
    return result.operator;
  }

  async getAllOperators(limit: number = 100): Promise<any[]> {
    const query = `
      query GetAllOperators($limit: Int!) {
        operators(
          first: $limit
          orderBy: registeredAt
          orderDirection: desc
        ) {
          id
          address
          registeredAt
          delegatorCount
          slashingEventCount
          lastActivityAt
        }
      }
    `;
    const result = await this.querySubgraph(query, { limit });
    return result.operators || [];
  }

  async getAVSSlashingEvents(avsAddress: string): Promise<any[]> {
    const query = `
      query GetAVSSlashingEvents($avsAddress: Bytes!) {
        operatorSlasheds(
          where: { operatorSet_: { avs_: { address: $avsAddress } } }
          orderBy: blockTimestamp
          orderDirection: desc
        ) {
          id
          blockTimestamp
          operator { id }
          operatorSet { id }
          strategies
          wadSlashed
          description
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      avsAddress: avsAddress.toLowerCase(),
    });
    return result.operatorSlasheds || [];
  }

  async getAVSOperatorAdoption(avsAddress: string): Promise<any[]> {
    const query = `
      query GetAVSOperatorAdoption($avsAddress: Bytes!) {
        operatorSetMemberships(
          where: { operatorSet_: { avs_: { address: $avsAddress } } }
          orderBy: joinedAt
          orderDirection: asc
        ) {
          operator { id }
          joinedAt
          leftAt
          isActive
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      avsAddress: avsAddress.toLowerCase(),
    });
    return result.operatorSetMemberships || [];
  }

  async getAVSInfo(avsAddress: string): Promise<any> {
    const query = `
      query GetAVSInfo($avsAddress: Bytes!) {
        avs(id: $avsAddress) {
          id
          address
          operatorSetCount
          totalOperatorRegistrations
          rewardsSubmissionCount
          slashingEventCount
          createdAt
          lastActivityAt
        }
      }
    `;
    const result = await this.querySubgraph(query, {
      avsAddress: avsAddress.toLowerCase(),
    });
    return result.avs;
  }

  // Calculate delegation totals from share events
  async calculateDelegationTotals(
    operatorAddress: string,
  ): Promise<DelegationStabilityData> {
    const shareEvents =
      await this.getOperatorDelegationHistory(operatorAddress);

    // Group by month and calculate net changes
    const monthlyTotals = new Map<string, number>();
    let currentTotal = 0;
    const delegators = new Set<string>();

    for (const event of shareEvents) {
      const monthKey = new Date(parseInt(event.blockTimestamp) * 1000)
        .toISOString()
        .slice(0, 7);
      const shares = parseFloat(event.shares);

      if (event.eventType === 'INCREASED') {
        currentTotal += shares;
        delegators.add(event.staker.id);
      } else {
        currentTotal -= shares;
      }

      monthlyTotals.set(monthKey, currentTotal);
    }

    const monthlyValues = Array.from(monthlyTotals.values());
    const mean =
      monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.length;
    const variance =
      monthlyValues.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
      monthlyValues.length;
    const stdDev = Math.sqrt(variance);

    return {
      totalDelegated: currentTotal,
      delegatorCount: delegators.size,
      volatilityCoefficient: mean > 0 ? stdDev / mean : 0,
      growthRate:
        monthlyValues.length > 1
          ? Math.pow(
              monthlyValues[monthlyValues.length - 1] / monthlyValues[0],
              1 / monthlyValues.length,
            ) - 1
          : 0,
      monthlyChanges: monthlyValues,
    };
  }
}
