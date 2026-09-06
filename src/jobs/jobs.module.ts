import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  redisConfig,
  type RedisConfiguration,
} from '../config/redis.config.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { bullMqConnectionFromUrl } from '../redis/redis-connection.js';
import { OrderConfirmationProcessor } from './order-confirmation.processor.js';
import { OrderQueue } from './order-jobs.constants.js';
import { OrderJobsService } from './order-jobs.service.js';

@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    PrismaModule,
    BullModule.forRootAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      inject: [redisConfig.KEY],
      useFactory: (config: RedisConfiguration) => ({
        connection: bullMqConnectionFromUrl(config.url),
        prefix: 'namou:bull',
      }),
    }),
    BullModule.registerQueue({
      name: OrderQueue.Name,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    }),
  ],
  providers: [OrderJobsService, OrderConfirmationProcessor],
  exports: [OrderJobsService],
})
export class JobsModule {}
