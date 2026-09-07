import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

export function configureApplication(
  app: INestApplication,
  configService?: ConfigService,
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

  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      statusCode: 429,
      message: 'Too many authentication attempts. Please try again later.',
    },
  });
  const activityLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  app.use('/auth/login', authLimiter);
  app.use('/auth/register', authLimiter);
  app.use('/auth/refresh', authLimiter);
  app.use('/chat', activityLimiter);
  app.use('/admin/chat', activityLimiter);
  app.use('/uploads', activityLimiter);

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
  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, openApiConfiguration),
    { jsonDocumentUrl: 'docs/openapi.json' },
  );
}
