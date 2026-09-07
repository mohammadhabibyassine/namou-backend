import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';
import { RateLimitService } from './rate-limit/rate-limit.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const rateLimitService = app.get(RateLimitService);

  configureApplication(app, configService, rateLimitService);
  const httpServer = app.getHttpAdapter().getInstance() as {
    set: (name: string, value: unknown) => void;
  };
  httpServer.set(
    'trust proxy',
    configService.get<number>('TRUST_PROXY_HOPS') ?? 0,
  );
  app.enableShutdownHooks();

  await app.listen(configService.getOrThrow<number>('PORT'));
}
await bootstrap();
