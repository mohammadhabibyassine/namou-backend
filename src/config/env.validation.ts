import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
  type ValidationError,
} from 'class-validator';

enum NodeEnvironment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65_535)
  PORT = 3000;

  @IsUrl({
    protocols: ['postgresql', 'postgres'],
    require_protocol: true,
    require_tld: false,
  })
  DATABASE_URL: string;

  @IsUrl({
    protocols: ['redis', 'rediss'],
    require_protocol: true,
    require_tld: false,
  })
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  CORS_ORIGINS = '';

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3_600)
  JWT_ACCESS_TTL_SECONDS = 900;

  @IsString()
  @MinLength(1)
  JWT_ISSUER = 'namou';

  @IsString()
  @MinLength(1)
  JWT_AUDIENCE = 'namou-api';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  REFRESH_TOKEN_TTL_DAYS = 30;

  @IsString()
  @MinLength(1)
  R2_ACCOUNT_ID: string;

  @IsString()
  @MinLength(1)
  R2_ACCESS_KEY_ID: string;

  @IsString()
  @MinLength(1)
  R2_SECRET_ACCESS_KEY: string;

  @IsString()
  @MinLength(1)
  R2_BUCKET_NAME: string;

  @IsUrl({ require_tld: false })
  R2_PUBLIC_URL: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(3_600)
  R2_PRESIGNED_URL_TTL_SECONDS?: number;
}

function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .flatMap((error) => Object.values(error.constraints ?? {}))
    .join('; ');
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, {
    forbidUnknownValues: true,
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed: ${formatValidationErrors(errors)}`,
    );
  }

  return { ...config, ...validated };
}
