import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { LoggerService } from './logger.service';
import { ApiException } from './exceptions/api.exception';
import { ErrorCodes } from './error-codes';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisCacheService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {}

  async set(key: string, data: any, ttlSeconds?: number): Promise<void> {
    try {
      const ttl =
        ttlSeconds || this.configService.get<number>('REDIS_TTL', 300);
      await this.cache.set(key, data, ttl);
      this.logger.log(
        `Cached data for key: ${key} (TTL: ${ttl}s)`,
        'RedisCacheService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to set cache for key: ${key}`,
        error.stack,
        'RedisCacheService',
      );
      throw new ApiException(
        ErrorCodes.CACHE_ERROR,
        'Failed to set cache',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { key, error: error.message },
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.cache.get<T>(key);
      if (data) {
        this.logger.log(`Cache hit for key: ${key}`, 'RedisCacheService');
      } else {
        this.logger.log(`Cache miss for key: ${key}`, 'RedisCacheService');
      }
      return data || null;
    } catch (error) {
      this.logger.error(
        `Failed to get cache for key: ${key}`,
        error.stack,
        'RedisCacheService',
      );
      throw new ApiException(
        ErrorCodes.CACHE_ERROR,
        'Failed to retrieve cache',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { key, error: error.message },
      );
    }
  }

  async clear(): Promise<void> {
    try {
      // Attempt to clear all cache keys using del('*')
      if (typeof (this.cache as any).store?.del === 'function') {
        await (this.cache as any).store.del('*');
      }
      this.logger.log('Cache cleared', 'RedisCacheService');
    } catch (error) {
      this.logger.error(
        'Failed to clear cache',
        error.stack,
        'RedisCacheService',
      );
      throw new ApiException(
        ErrorCodes.CACHE_ERROR,
        'Failed to clear cache',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { error: error.message },
      );
    }
  }
}
