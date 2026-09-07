import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import {
  redisConfig,
  type RedisConfiguration,
} from '../config/redis.config.js';

const RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { count, redis.call('PTTL', KEYS[1]) }
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(redisConfig.KEY) config: RedisConfiguration) {
    this.redis = new Redis(config.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  createHttpStore(prefix: string): RedisStore {
    return new RedisStore({
      prefix,
      sendCommand: (...args: string[]) =>
        this.redis.call(args[0], ...args.slice(1)) as Promise<
          boolean | number | string | Array<boolean | number | string>
        >,
    });
  }

  async consume(
    namespace: string,
    key: string,
    limit: number,
    windowMilliseconds: number,
  ): Promise<RateLimitResult> {
    const result = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      1,
      `namou:ratelimit:${namespace}:${key}`,
      windowMilliseconds,
    )) as [number, number];
    const retryAfterSeconds = Math.max(1, Math.ceil(result[1] / 1_000));

    return {
      allowed: result[0] <= limit,
      retryAfterSeconds,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
