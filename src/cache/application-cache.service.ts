import { createHash, randomUUID } from 'node:crypto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import type { CacheNamespaceName } from './cache.constants.js';

@Injectable()
export class ApplicationCacheService {
  private readonly logger = new Logger(ApplicationCacheService.name);
  private readonly inFlightLoads = new Map<string, Promise<unknown>>();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  async remember<T>(
    namespace: CacheNamespaceName,
    logicalKey: string,
    ttlMilliseconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const generation = await this.getGeneration(namespace);
    const cacheKey = this.valueKey(namespace, generation, logicalKey);
    const cached = await this.safeGet<T>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;

    const inFlight = this.inFlightLoads.get(cacheKey) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const load = loader().then(async (value) => {
      await this.safeSet(cacheKey, value, ttlMilliseconds);
      return value;
    });
    this.inFlightLoads.set(cacheKey, load);

    try {
      return await load;
    } finally {
      if (this.inFlightLoads.get(cacheKey) === load) {
        this.inFlightLoads.delete(cacheKey);
      }
    }
  }

  async invalidate(...namespaces: CacheNamespaceName[]): Promise<void> {
    await Promise.all(
      [...new Set(namespaces)].map((namespace) =>
        this.safeSet(this.generationKey(namespace), randomUUID(), 0),
      ),
    );
  }

  private async getGeneration(namespace: CacheNamespaceName): Promise<string> {
    return (
      (await this.safeGet<string>(this.generationKey(namespace))) ?? 'initial'
    );
  }

  private generationKey(namespace: CacheNamespaceName): string {
    return `generation:${namespace}`;
  }

  private valueKey(
    namespace: CacheNamespaceName,
    generation: string,
    logicalKey: string,
  ): string {
    const digest = createHash('sha256')
      .update(logicalKey)
      .digest('base64url')
      .slice(0, 32);
    return `value:${namespace}:${generation}:${digest}`;
  }

  private async safeGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.cache.get<T>(key);
    } catch (error: unknown) {
      this.logger.warn(`Cache read failed: ${this.errorMessage(error)}`);
      return undefined;
    }
  }

  private async safeSet<T>(
    key: string,
    value: T,
    ttlMilliseconds: number,
  ): Promise<void> {
    try {
      await this.cache.set(key, value, ttlMilliseconds);
    } catch (error: unknown) {
      this.logger.warn(`Cache write failed: ${this.errorMessage(error)}`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown Redis error';
  }
}
