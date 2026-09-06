import { registerAs } from '@nestjs/config';

export interface RedisConfiguration {
  url: string;
}

export const redisConfig = registerAs('redis', (): RedisConfiguration => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
}));
