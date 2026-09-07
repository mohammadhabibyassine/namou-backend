import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { redisConfig } from '../config/redis.config.js';
import { RateLimitService } from './rate-limit.service.js';

@Global()
@Module({
  imports: [ConfigModule.forFeature(redisConfig)],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
