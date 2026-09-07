import { registerAs, type ConfigType } from '@nestjs/config';

export const authConfig = registerAs('auth', () => ({
  accessToken: {
    secret: process.env.JWT_ACCESS_SECRET as string,
    ttlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS),
    issuer: process.env.JWT_ISSUER as string,
    audience: process.env.JWT_AUDIENCE as string,
  },
  refreshToken: {
    ttlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS),
  },
}));

export type AuthConfiguration = ConfigType<typeof authConfig>;
