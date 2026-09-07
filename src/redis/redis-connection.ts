import type { RedisOptions } from 'bullmq';

export function bullMqConnectionFromUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const database = url.pathname.slice(1);

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database ? Number(database) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}
