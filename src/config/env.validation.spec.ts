import { validateEnvironment } from './env.validation.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/namou',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a-secure-test-secret-that-is-long-enough',
  JWT_ACCESS_TTL_SECONDS: '900',
  JWT_ISSUER: 'namou',
  JWT_AUDIENCE: 'namou-api',
  REFRESH_TOKEN_TTL_DAYS: '30',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET_NAME: 'test-bucket',
  R2_PUBLIC_URL: 'https://media.namou.test',
  R2_PRESIGNED_URL_TTL_SECONDS: '600',
};

describe('validateEnvironment', () => {
  it('validates and converts numeric configuration', () => {
    const result = validateEnvironment(validEnvironment);

    expect(result.PORT).toBe(3001);
    expect(result.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(result.R2_PRESIGNED_URL_TTL_SECONDS).toBe(600);
  });

  it('rejects a missing JWT access secret', () => {
    const { JWT_ACCESS_SECRET: _unused, ...environment } = validEnvironment;

    expect(() => validateEnvironment(environment)).toThrow(
      'Environment validation failed',
    );
  });

  it('rejects an excessive access-token lifetime', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_ACCESS_TTL_SECONDS: '7200',
      }),
    ).toThrow('Environment validation failed');
  });

  it('rejects a non-Redis cache and queue URL', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        REDIS_URL: 'https://localhost:6379',
      }),
    ).toThrow('Environment validation failed');
  });
});
