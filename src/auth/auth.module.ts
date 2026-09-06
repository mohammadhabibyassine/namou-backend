import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { authConfig, type AuthConfiguration } from '../config/auth.config.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthenticationGuard } from './guards/jwt-authentication.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';
import { JwtStrategy } from './jwt/jwt.strategy.js';
import { AccessTokenVerifier } from './jwt/access-token-verifier.js';
import { Argon2PasswordHasher } from './password/argon2-password-hasher.js';
import { PasswordHasher } from './password/password-hasher.js';
import { AuthTokensService } from './tokens/auth-tokens.service.js';
import { ACCESS_TOKEN_ALGORITHM } from './tokens/token.constants.js';

@Module({
  imports: [
    ConfigModule.forFeature(authConfig),
    PrismaModule,
    UsersModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
      session: false,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule.forFeature(authConfig)],
      inject: [authConfig.KEY],
      useFactory: (config: AuthConfiguration): JwtModuleOptions => ({
        secret: config.accessToken.secret,
        signOptions: {
          algorithm: ACCESS_TOKEN_ALGORITHM,
          expiresIn: config.accessToken.ttlSeconds,
          issuer: config.accessToken.issuer,
          audience: config.accessToken.audience,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthTokensService,
    JwtStrategy,
    AccessTokenVerifier,
    {
      provide: APP_GUARD,
      useClass: JwtAuthenticationGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: PasswordHasher,
      useClass: Argon2PasswordHasher,
    },
  ],
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
