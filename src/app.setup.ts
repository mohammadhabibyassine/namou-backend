import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { RateLimitService } from './rate-limit/rate-limit.service.js';

export function configureApplication(
  app: INestApplication,
  configService?: ConfigService,
  rateLimitService?: RateLimitService,
): void {
  app.use(helmet());

  const corsOrigins = (
    configService?.get<string>('CORS_ORIGINS') ??
    process.env.CORS_ORIGINS ??
    ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors(
    corsOrigins.length > 0 ? { origin: corsOrigins, credentials: true } : false,
  );

  const createLimiter = (
    limit: number,
    prefix: string,
    message = 'Too many requests. Please try again later.',
  ) =>
    rateLimit({
      windowMs: 60_000,
      limit,
      store: rateLimitService?.createHttpStore(prefix),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        statusCode: 429,
        message,
      },
    });
  const loginLimiter = createLimiter(
    10,
    'http:auth-login',
    'Too many login attempts. Please try again later.',
  );
  const registerLimiter = createLimiter(
    10,
    'http:auth-register',
    'Too many registration attempts. Please try again later.',
  );
  const refreshLimiter = createLimiter(
    60,
    'http:auth-refresh',
    'Too many refresh attempts. Please try again later.',
  );
  const activityLimiter = createLimiter(120, 'http:activity');
  const catalogLimiter = createLimiter(120, 'http:catalog');
  app.use('/auth/login', loginLimiter);
  app.use('/auth/register', registerLimiter);
  app.use('/auth/refresh', refreshLimiter);
  app.use('/chat', activityLimiter);
  app.use('/admin/chat', activityLimiter);
  app.use('/uploads', activityLimiter);
  app.use('/products', catalogLimiter);
  app.use('/categories', catalogLimiter);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  const openApiConfiguration = new DocumentBuilder()
    .setTitle('namou API')
    .setDescription('Mini e-commerce HTTP API')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  const nodeEnvironment =
    configService?.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
  if (nodeEnvironment !== 'production') {
    SwaggerModule.setup(
      'docs',
      app,
      () => SwaggerModule.createDocument(app, openApiConfiguration),
      { jsonDocumentUrl: 'docs/openapi.json' },
    );
  }
}
