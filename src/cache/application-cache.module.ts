import { createKeyvNonBlocking } from '@keyv/redis';
import { deserialize, serialize } from 'node:v8';
import { CacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  redisConfig,
  type RedisConfiguration,
} from '../config/redis.config.js';
import { ApplicationCacheService } from './application-cache.service.js';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      inject: [redisConfig.KEY],
      useFactory: (config: RedisConfiguration) => {
        const redisStore = createKeyvNonBlocking(config.url, {
          namespace: 'namou-cache-v2',
          connectionTimeout: 1_000,
        });
        // Keyv's JSON default converts Date instances into strings. V8's
        // structured serializer preserves the exact types returned by domain
        // services so a cache hit is behaviorally identical to a DB read.
        redisStore.serialize = (value) =>
          serialize(value).toString('base64url');
        redisStore.deserialize = (value) =>
          deserialize(Buffer.from(value, 'base64url'));
        return { stores: [redisStore] };
      },
    }),
  ],
  providers: [ApplicationCacheService],
  exports: [ApplicationCacheService],
})
export class ApplicationCacheModule {}
