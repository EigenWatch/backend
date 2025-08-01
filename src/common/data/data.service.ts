import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LoggerService } from '../logger.service';
import { RedisCacheService } from '../redis-cache.service';
import {
  OperatorCommissionEvent,
  OperatorSetMembership,
  DelegationStabilityData,
  RewardsSubmission,
} from '../interfaces/risk.interfaces';

@Injectable()
export class DataService {
  private readonly subgraphUrl: string;
  private readonly subgraphApiKey: string;
  private readonly historicalTimestamp: number;

  // Request management
  private readonly requestQueue: Array<{
    id: string;
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
    timestamp: number;
  }> = [];

  private readonly pendingRequests = new Map<string, Promise<any>>();
  private readonly activeRequests = new Set<string>();
  // TODO: Remove or move to redis in production
  private readonly processedRequests = new Map<
    string,
    { result: any; timestamp: number }
  >();
  private isProcessingQueue = false;

  // Configuration
  private readonly MAX_CONCURRENT_REQUESTS = 3;
  private readonly QUEUE_PROCESSING_INTERVAL = 100; // ms
  private readonly REQUEST_TIMEOUT = 250000; // 25 seconds (less than 30s subgraph timeout)
  private readonly EXPIRY_DURATION = 60 * 60 * 1000; // 1 hour

  // Circuit breaker
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT = 60000; // 1 minute

  // Historical data configuration - easy to modify
  private readonly HISTORICAL_CONFIG = {
    YEARS_BACK: 1, // Change this to adjust how far back to query
    MONTHS_BACK: 0, // Additional months on top of years
    DAYS_BACK: 0, // Additional days if needed
  };

  // Cache TTL settings - easy to modify
  private readonly CACHE_TTL = {
    DEFAULT: 5 * 24 * 60 * 60, // 5 days in seconds
    OPERATOR_INFO: 5 * 24 * 60 * 60, // 5 days for operator registration info
    SLASHING_EVENTS: 5 * 24 * 60 * 60, // 5 days for slashing events
    DELEGATION_HISTORY: 5 * 24 * 60 * 60, // 5 days for delegation history
    AVS_INFO: 5 * 24 * 60 * 60, // 5 days for AVS info
    OPERATOR_LIST: 2 * 60 * 60, // 2 hours for operator lists (more dynamic)
  };

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly cacheService: RedisCacheService,
  ) {
    this.subgraphUrl = process.env.EIGENWATCH_SUBGRAPH_URL || '';
    this.subgraphApiKey = process.env.EIGENWATCH_SUBGRAPH_API_KEY || '';

    // Calculate historical timestamp dynamically
    this.historicalTimestamp = this.calculateHistoricalTimestamp();

    // Start queue processor
    this.startQueueProcessor();

    // Start cleanup loop for processed requests
    setInterval(
      () => {
        const now = Date.now();
        for (const [id, entry] of this.processedRequests.entries()) {
          if (now - entry.timestamp > this.EXPIRY_DURATION) {
            this.processedRequests.delete(id);
          }
        }
      },
      10 * 60 * 1000,
    ); // every 10 minutes
  }

  /**
   * Calculate historical timestamp based on configuration
   */
  private calculateHistoricalTimestamp(): number {
    const now = new Date();
    const historicalDate = new Date(now);

    // Apply years back
    if (this.HISTORICAL_CONFIG.YEARS_BACK > 0) {
      historicalDate.setFullYear(
        now.getFullYear() - this.HISTORICAL_CONFIG.YEARS_BACK,
      );
    }

    // Apply additional months back
    if (this.HISTORICAL_CONFIG.MONTHS_BACK > 0) {
      historicalDate.setMonth(
        historicalDate.getMonth() - this.HISTORICAL_CONFIG.MONTHS_BACK,
      );
    }

    // Apply additional days back
    if (this.HISTORICAL_CONFIG.DAYS_BACK > 0) {
      historicalDate.setDate(
        historicalDate.getDate() - this.HISTORICAL_CONFIG.DAYS_BACK,
      );
    }

    const timestamp = Math.floor(historicalDate.getTime() / 1000);

    this.logger.log(
      `Historical timestamp calculated: ${this.HISTORICAL_CONFIG.YEARS_BACK} years, ${this.HISTORICAL_CONFIG.MONTHS_BACK} months, ${this.HISTORICAL_CONFIG.DAYS_BACK} days back = ${new Date(timestamp * 1000).toISOString()}`,
      'DataService',
    );

    return timestamp;
  }

  /**
   * Generate cache key for queries with context
   */
  private getCacheKey(method: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce(
        (result, key) => {
          result[key] = params[key];
          return result;
        },
        {} as Record<string, any>,
      );

    return `eigenlayer:${method}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * Generate unique request ID for deduplication
   */
  private getRequestId(query: string, variables: any): string {
    return `${query.replace(/\s+/g, ' ').trim()}_${JSON.stringify(variables)}`;
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitOpen(): boolean {
    if (this.failureCount < this.FAILURE_THRESHOLD) return false;

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure > this.RECOVERY_TIMEOUT) {
      this.failureCount = 0;
      this.logger.log(
        'Circuit breaker reset - resuming requests',
        'DataService',
      );
      return false;
    }

    return true;
  }
  /**
   * Process queued requests respecting concurrency limits
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    if (this.isCircuitOpen()) {
      this.logger.warn(
        'Circuit breaker open - skipping queue processing',
        'DataService',
      );
      return;
    }

    const availableSlots =
      this.MAX_CONCURRENT_REQUESTS - this.activeRequests.size;
    if (availableSlots <= 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Sort by priority (higher first) then by timestamp (older first)
      this.requestQueue.sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.timestamp - b.timestamp;
      });

      const requestsToProcess = this.requestQueue.splice(0, availableSlots);

      for (const request of requestsToProcess) {
        this.activeRequests.add(request.id);

        // Check if already processed
        if (this.processedRequests.has(request.id)) {
          this.logger.log(
            `Request already processed: ${request.id.substring(0, 50)}...`,
            'DataService',
          );

          // Clean up and continue
          this.activeRequests.delete(request.id);
          continue;
        }

        // Process request with comprehensive error handling
        this.processRequestSafely(request);
      }
    } catch (error) {
      // Catch any synchronous errors in queue processing
      this.logger.error(
        `Error in queue processing: ${error.message}`,
        error.stack,
        'DataService',
      );
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Process a single request with comprehensive error handling
   */
  private processRequestSafely(request: {
    id: string;
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
    timestamp: number;
  }): void {
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Request timeout')),
          this.REQUEST_TIMEOUT,
        );
      });

      // Execute request with timeout
      const executePromise = request.execute();

      // Race between execution and timeout
      Promise.race([executePromise, timeoutPromise])
        .then((result) => {
          try {
            this.recordSuccess();
            this.processedRequests.set(request.id, {
              result,
              timestamp: Date.now(),
            });
            request.resolve(result);
          } catch (resolveError) {
            // Handle errors in success handling
            this.logger.error(
              `Error in request success handling: ${resolveError.message}`,
              resolveError.stack,
              'DataService',
            );
            // Still try to resolve with the result even if other operations failed
            try {
              request.resolve(result);
            } catch (finalResolveError) {
              this.logger.error(
                `Fatal error in request resolution: ${finalResolveError.message}`,
                finalResolveError.stack,
                'DataService',
              );
            }
          }
        })
        .catch((error) => {
          try {
            this.recordFailure();
            this.logger.error(
              `Queued request failed: ${request.id.substring(0, 100)}...`,
              error.stack || error.message,
              'DataService',
            );

            // Store error in processed requests
            this.processedRequests.set(request.id, {
              result: error,
              timestamp: Date.now(),
            });

            request.reject(error);
          } catch (rejectError) {
            // Handle errors in error handling
            this.logger.error(
              `Error in request error handling: ${rejectError.message}`,
              rejectError.stack,
              'DataService',
            );
            // Still try to reject with the original error
            try {
              request.reject(error);
            } catch (finalRejectError) {
              this.logger.error(
                `Fatal error in request rejection: ${finalRejectError.message}`,
                finalRejectError.stack,
                'DataService',
              );
            }
          }
        })
        .finally(() => {
          try {
            this.activeRequests.delete(request.id);
          } catch (cleanupError) {
            // Handle errors in cleanup
            this.logger.error(
              `Error in request cleanup: ${cleanupError.message}`,
              cleanupError.stack,
              'DataService',
            );
            // Force cleanup even if it fails
            try {
              this.activeRequests.delete(request.id);
            } catch (finalCleanupError) {
              this.logger.error(
                `Fatal error in request cleanup: ${finalCleanupError.message}`,
                finalCleanupError.stack,
                'DataService',
              );
            }
          }
        });
    } catch (synchronousError) {
      // Handle any synchronous errors in request processing setup
      this.logger.error(
        `Synchronous error in request processing: ${synchronousError.message}`,
        synchronousError.stack,
        'DataService',
      );

      try {
        this.recordFailure();
        this.processedRequests.set(request.id, {
          result: synchronousError,
          timestamp: Date.now(),
        });
        request.reject(synchronousError);
      } catch (syncErrorHandlingError) {
        this.logger.error(
          `Error handling synchronous error: ${syncErrorHandlingError.message}`,
          syncErrorHandlingError.stack,
          'DataService',
        );
      } finally {
        try {
          this.activeRequests.delete(request.id);
        } catch (syncCleanupError) {
          this.logger.error(
            `Error in synchronous cleanup: ${syncCleanupError.message}`,
            syncCleanupError.stack,
            'DataService',
          );
        }
      }
    }
  }

  /**
   * Queue processor - runs continuously with error handling
   */
  private startQueueProcessor(): void {
    setInterval(() => {
      try {
        this.processQueue().catch((error) => {
          // Catch any unhandled promise rejections from processQueue
          this.logger.error(
            `Unhandled error in queue processing: ${error.message}`,
            error.stack,
            'DataService',
          );
        });
      } catch (error) {
        // Catch any synchronous errors from calling processQueue
        this.logger.error(
          `Error starting queue processing: ${error.message}`,
          error.stack,
          'DataService',
        );
      }
    }, this.QUEUE_PROCESSING_INTERVAL);
  }

  /**
   * Enhanced error handling for the circuit breaker methods
   */
  private recordFailure(): void {
    try {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.FAILURE_THRESHOLD) {
        this.logger.warn(
          `Circuit breaker opened - too many failures (${this.failureCount})`,
          'DataService',
        );
      }
    } catch (error) {
      this.logger.error(
        `Error recording failure in circuit breaker: ${error.message}`,
        error.stack,
        'DataService',
      );
    }
  }

  /**
   * Enhanced error handling for the circuit breaker methods
   */
  private recordSuccess(): void {
    try {
      if (this.failureCount > 0) {
        this.failureCount = 0;
        this.logger.log(
          'Circuit breaker closed - requests successful',
          'DataService',
        );
      }
    } catch (error) {
      this.logger.error(
        `Error recording success in circuit breaker: ${error.message}`,
        error.stack,
        'DataService',
      );
    }
  }
  /**
   * Queue a request for execution with deduplication
   */
  private async queueSubgraphRequest<T>(
    query: string,
    variables: any,
    priority: number = 1,
  ): Promise<T> {
    const requestId = this.getRequestId(query, variables);

    // Check if same request is already pending
    if (this.pendingRequests.has(requestId)) {
      this.logger.log(
        `Deduplicating request: ${requestId.substring(0, 50)}...`,
        'DataService',
      );
      return this.pendingRequests.get(requestId);
    }

    // Create new request promise
    const requestPromise = new Promise<T>((resolve, reject) => {
      const queueItem = {
        id: requestId,
        execute: () => this.executeSubgraphQuery(query, variables),
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      };

      this.requestQueue.push(queueItem);

      this.logger.log(
        `Queued request (priority: ${priority}, queue size: ${this.requestQueue.length}, active: ${this.activeRequests.size}, processed: ${this.processedRequests.size}): ${requestId.substring(0, 50)}...`,
        'DataService',
      );
    });

    // Store pending request for deduplication
    this.pendingRequests.set(requestId, requestPromise);

    // Clean up after completion
    requestPromise.finally(() => {
      this.pendingRequests.delete(requestId);
    });

    return requestPromise;
  }

  /**
   * Execute actual subgraph query
   */
  private async executeSubgraphQuery(
    query: string,
    variables: any,
  ): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.subgraphUrl,
          { query, variables },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.subgraphApiKey}`,
            },
            timeout: this.REQUEST_TIMEOUT,
          },
        ),
      );

      if (response.data.errors) {
        const errorMessage = `GraphQL errors: ${JSON.stringify(response.data.errors)}`;
        throw new Error(errorMessage);
      }

      return response.data.data;
    } catch (error) {
      // Enhanced error logging with more details
      const errorDetails = {
        message: error.message || 'Unknown error',
        code: error.code || 'UNKNOWN',
        status: error.response?.status || 'N/A',
        url: this.subgraphUrl,
        queryVariables: variables,
        stack: error.stack,
      };

      this.logger.error(
        `Subgraph query execution failed: ${JSON.stringify(errorDetails)}`,
        error.stack,
        'DataService',
      );

      // More specific error based on error type
      if (error.code === 'ETIMEDOUT') {
        throw new HttpException(
          'Subgraph request timed out - API may be overloaded',
          HttpStatus.REQUEST_TIMEOUT,
        );
      } else if (
        error.response?.status >= 400 &&
        error.response?.status < 500
      ) {
        throw new HttpException(
          `Subgraph API error: ${error.message}`,
          error.response.status,
        );
      } else {
        throw new HttpException(
          `Failed to fetch data from subgraph: ${error.message || 'Unknown error'}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }

  /**
   * Cached query wrapper with request management
   */
  private async cachedQuery<T>(
    cacheKey: string,
    queryFn: () => Promise<T>,
    ttl: number = this.CACHE_TTL.DEFAULT,
    priority: number = 1,
  ): Promise<T> {
    try {
      // Check cache first
      const cached = await this.cacheService.get<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Cache miss - execute query with request management
      this.logger.log(
        `Cache miss for ${cacheKey}, queuing subgraph request`,
        'DataService',
      );

      const result = await queryFn();

      // Cache the result only if successful
      if (result !== null && result !== undefined) {
        await this.cacheService.set(cacheKey, result, ttl);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Cached query failed for ${cacheKey}: ${error.message}`,
        error.stack,
        'DataService',
      );

      // For circuit breaker - check if we should return cached data even if stale
      if (this.isCircuitOpen()) {
        this.logger.warn(
          `Circuit breaker open, attempting to return stale cached data for ${cacheKey}`,
          'DataService',
        );

        try {
          // Try to get any cached data, even if expired
          const staleData = await this.cacheService.get<T>(cacheKey);
          if (staleData !== null) {
            this.logger.warn(
              `Returning stale cached data for ${cacheKey} due to circuit breaker`,
              'DataService',
            );
            return staleData;
          }
        } catch (cacheError) {
          // Ignore cache errors when circuit is open
        }
      }

      throw error;
    }
  }

  // Legacy method for backward compatibility - will be deprecated
  private async querySubgraph(query: string, variables: any): Promise<any> {
    return this.queueSubgraphRequest<any>(query, variables, 1);
  }

  async getOperatorSlashingEvents(operatorAddress: string): Promise<any[]> {
    const cacheKey = this.getCacheKey('operatorSlashingEvents', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetOperatorSlashingEvents($operatorAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorSlasheds(
              where: { 
                operator_: { address: $operatorAddress }
                blockTimestamp_gte: $fromTimestamp
              }
              orderBy: blockTimestamp
              orderDirection: desc
              first: 100
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          2,
        ); // Higher priority for slashing events

        return result.operatorSlasheds || [];
      },
      this.CACHE_TTL.SLASHING_EVENTS,
      2,
    );
  }

  async getOperatorDelegationHistory(
    operatorAddress: string,
    fromTimestamp?: number,
  ): Promise<any[]> {
    const timeFilter = fromTimestamp || this.historicalTimestamp;
    const cacheKey = this.getCacheKey('operatorDelegationHistory', {
      operatorAddress: operatorAddress.toLowerCase(),
      // Only include custom timestamp in cache key if it's different from default
      ...(fromTimestamp &&
        fromTimestamp !== this.historicalTimestamp && {
          customTimestamp: fromTimestamp.toString(),
        }),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetOperatorShareEvents($operatorAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorShareEvents(
              where: { 
                operator_: { address: $operatorAddress }
                blockTimestamp_gte: $fromTimestamp
              }
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
            fromTimestamp: timeFilter.toString(),
          },
          1,
        ); // Standard priority

        return result.operatorShareEvents || [];
      },
      this.CACHE_TTL.DELEGATION_HISTORY,
      1,
    );
  }

  async getOperatorCommissionEvents(
    operatorAddress: string,
  ): Promise<OperatorCommissionEvent[]> {
    const cacheKey = this.getCacheKey('operatorCommissionEvents', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetOperatorCommissionEvents($operatorAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorCommissionEvents(
              where: { 
                operator_: { address: $operatorAddress }
                blockTimestamp_gte: $fromTimestamp
              }
              orderBy: blockTimestamp
              orderDirection: desc
              first: 100
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.operatorCommissionEvents || [];
      },
      this.CACHE_TTL.DEFAULT,
      1,
    );
  }

  async getOperatorSetMemberships(
    operatorAddress: string,
  ): Promise<OperatorSetMembership[]> {
    const cacheKey = this.getCacheKey('operatorSetMemberships', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetOperatorSetMemberships($operatorAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorSetMemberships(
              where: { 
                operator_: { address: $operatorAddress }
                joinedAt_gte: $fromTimestamp
              }
              orderBy: joinedAt
              orderDirection: asc
              first: 100
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.operatorSetMemberships || [];
      },
      this.CACHE_TTL.DEFAULT,
      1,
    );
  }

  async getOperatorRegistrationInfo(operatorAddress: string): Promise<any> {
    const cacheKey = this.getCacheKey('operatorRegistrationInfo', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
          },
          1,
        );

        return result.operator;
      },
      this.CACHE_TTL.OPERATOR_INFO,
      1,
    );
  }

  async getAllOperators(limit: number = 100): Promise<any[]> {
    const cacheKey = this.getCacheKey('allOperators', {
      limit,
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetAllOperators($limit: Int!, $fromTimestamp: BigInt!) {
            operators(
              where: { lastActivityAt_gte: $fromTimestamp }
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            limit,
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.operators || [];
      },
      this.CACHE_TTL.OPERATOR_LIST,
      1,
    );
  }

  async getAVSSlashingEvents(avsAddress: string): Promise<any[]> {
    const cacheKey = this.getCacheKey('avsSlashingEvents', {
      avsAddress: avsAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetAVSSlashingEvents($avsAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorSlasheds(
              where: { 
                operatorSet_: { avs_: { address: $avsAddress } }
                blockTimestamp_gte: $fromTimestamp
              }
              orderBy: blockTimestamp
              orderDirection: desc
              first: 100
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            avsAddress: avsAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          2,
        ); // Higher priority for slashing events

        return result.operatorSlasheds || [];
      },
      this.CACHE_TTL.SLASHING_EVENTS,
      2,
    );
  }

  async getAVSOperatorAdoption(avsAddress: string): Promise<any[]> {
    const cacheKey = this.getCacheKey('avsOperatorAdoption', {
      avsAddress: avsAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetAVSOperatorAdoption($avsAddress: Bytes!, $fromTimestamp: BigInt!) {
            operatorSetMemberships(
              where: { 
                operatorSet_: { avs_: { address: $avsAddress } }
                joinedAt_gte: $fromTimestamp
              }
              orderBy: joinedAt
              orderDirection: asc
              first: 200
            ) {
              operator { id }
              joinedAt
              leftAt
              isActive
            }
          }
        `;

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            avsAddress: avsAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.operatorSetMemberships || [];
      },
      this.CACHE_TTL.DEFAULT,
      1,
    );
  }

  async getAVSInfo(avsAddress: string): Promise<any> {
    const cacheKey = this.getCacheKey('avsInfo', {
      avsAddress: avsAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
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

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            avsAddress: avsAddress.toLowerCase(),
          },
          1,
        );

        return result.avs;
      },
      this.CACHE_TTL.AVS_INFO,
      1,
    );
  }

  // Calculate delegation totals from share events (last 6 months)
  async calculateDelegationTotals(
    operatorAddress: string,
  ): Promise<DelegationStabilityData> {
    const cacheKey = this.getCacheKey('delegationTotals', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
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
      },
      this.CACHE_TTL.DELEGATION_HISTORY,
      1,
    );
  }

  // Get AVS rewards submissions for economic sustainability analysis
  async getAVSRewardsSubmissions(
    avsAddress: string,
  ): Promise<RewardsSubmission[]> {
    const cacheKey = this.getCacheKey('avsRewardsSubmissions', {
      avsAddress: avsAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetAVSRewardsSubmissions($avsAddress: Bytes!, $fromTimestamp: BigInt!) {
            rewardsSubmissions(
              where: { 
                avs_: { address: $avsAddress }
                blockTimestamp_gte: $fromTimestamp
              }
              orderBy: blockTimestamp
              orderDirection: desc
              first: 100
            ) {
              id
              transactionHash
              logIndex
              blockNumber
              blockTimestamp
              contractAddress
              avs { id }
              submitter
              submissionNonce
              rewardsSubmissionHash
              submissionType
              strategiesAndMultipliers
              token
              amount
              startTimestamp
              duration
              operatorRewards
              description
              operatorSetId
            }
          }
        `;

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            avsAddress: avsAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.rewardsSubmissions || [];
      },
      this.CACHE_TTL.DEFAULT,
      1,
    );
  }

  /**
   * Get operator allocation events for portfolio risk calculation
   */
  async getOperatorAllocationEvents(operatorAddress: string): Promise<any[]> {
    const cacheKey = this.getCacheKey('operatorAllocationEvents', {
      operatorAddress: operatorAddress.toLowerCase(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetOperatorAllocationEvents($operatorAddress: Bytes!, $fromTimestamp: BigInt!) {
            allocationEvents(
              where: { 
                operator_: { address: $operatorAddress }
                blockTimestamp_gte: $fromTimestamp
              }
              orderBy: blockTimestamp
              orderDirection: asc
              first: 200
            ) {
              id
              transactionHash
              blockTimestamp
              operator { id }
              operatorSet { 
                id 
                avs { id }
              }
              strategy { id }
              magnitude
              effectBlock
            }
          }
        `;

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            operatorAddress: operatorAddress.toLowerCase(),
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        return result.allocationEvents || [];
      },
      this.CACHE_TTL.DEFAULT,
      1,
    );
  }

  /**
   * Get all AVS addresses in the system for ecosystem analysis
   */
  async getAllAVSAddresses(limit: number = 100): Promise<string[]> {
    const cacheKey = this.getCacheKey('allAVSAddresses', {
      limit,
      fromTimestamp: this.historicalTimestamp.toString(),
    });

    return this.cachedQuery(
      cacheKey,
      async () => {
        const query = `
          query GetAllAVS($limit: Int!, $fromTimestamp: BigInt!) {
            avss(
              where: { lastActivityAt_gte: $fromTimestamp }
              first: $limit
              orderBy: createdAt
              orderDirection: desc
            ) {
              id
              address
            }
          }
        `;

        const result = await this.queueSubgraphRequest<any>(
          query,
          {
            limit,
            fromTimestamp: this.historicalTimestamp.toString(),
          },
          1,
        );

        const avsList = result.avss || [];
        return avsList.map((avs: any) => avs.address);
      },
      this.CACHE_TTL.OPERATOR_LIST,
      1,
    );
  }

  /**
   * Helper method to get the historical timestamp for external use
   */
  getHistoricalTimestamp(): number {
    return this.historicalTimestamp;
  }

  /**
   * Update historical configuration and recalculate timestamp
   */
  updateHistoricalConfig(config: {
    yearsBack?: number;
    monthsBack?: number;
    daysBack?: number;
  }): void {
    if (config.yearsBack !== undefined) {
      (this.HISTORICAL_CONFIG as any).YEARS_BACK = config.yearsBack;
    }
    if (config.monthsBack !== undefined) {
      (this.HISTORICAL_CONFIG as any).MONTHS_BACK = config.monthsBack;
    }
    if (config.daysBack !== undefined) {
      (this.HISTORICAL_CONFIG as any).DAYS_BACK = config.daysBack;
    }

    // Recalculate the timestamp
    (this as any).historicalTimestamp = this.calculateHistoricalTimestamp();

    this.logger.log(
      `Historical configuration updated: ${JSON.stringify(this.HISTORICAL_CONFIG)}`,
      'DataService',
    );
  }

  /**
   * Get current historical configuration
   */
  getHistoricalConfig(): {
    yearsBack: number;
    monthsBack: number;
    daysBack: number;
    calculatedDate: string;
  } {
    return {
      yearsBack: this.HISTORICAL_CONFIG.YEARS_BACK,
      monthsBack: this.HISTORICAL_CONFIG.MONTHS_BACK,
      daysBack: this.HISTORICAL_CONFIG.DAYS_BACK,
      calculatedDate: new Date(this.historicalTimestamp * 1000).toISOString(),
    };
  }

  /**
   * Get queue status for monitoring
   */
  getQueueStatus(): {
    queueSize: number;
    activeRequests: number;
    failureCount: number;
    circuitOpen: boolean;
    pendingDeduplication: number;
  } {
    return {
      queueSize: this.requestQueue.length,
      activeRequests: this.activeRequests.size,
      failureCount: this.failureCount,
      circuitOpen: this.isCircuitOpen(),
      pendingDeduplication: this.pendingRequests.size,
    };
  }

  /**
   * Cache management methods
   */
  async clearCache(): Promise<void> {
    await this.cacheService.clear();
    this.logger.log('All DataService cache cleared', 'DataService');
  }

  async clearOperatorCache(operatorAddress: string): Promise<void> {
    // This would require implementing pattern-based deletion in your cache service
    // For now, we'll just log the intent
    this.logger.log(
      `Would clear cache for operator: ${operatorAddress}`,
      'DataService',
    );
  }

  /**
   * Method to update cache TTL values (useful for runtime configuration)
   */
  updateCacheTTL(type: keyof typeof this.CACHE_TTL, seconds: number): void {
    (this.CACHE_TTL as any)[type] = seconds;
    this.logger.log(
      `Updated cache TTL for ${type}: ${seconds}s`,
      'DataService',
    );
  }
}
