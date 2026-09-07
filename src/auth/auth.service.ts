import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { isPrismaKnownRequestError } from '../prisma/prisma-error.js';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshTokenDto } from './dto/refresh-token.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordHasher } from './password/password-hasher.js';
import { AuthTokensService } from './tokens/auth-tokens.service.js';
import type {
  LoginContext,
  LoginResult,
  RegistrationResult,
  TokenPair,
} from './auth.types.js';

const REGISTRATION_ROLE = 'customer';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordHasher: PasswordHasher,
    private readonly authTokensService: AuthTokensService,
  ) {}

  async register(input: RegisterDto): Promise<RegistrationResult> {
    // Hash before attempting the insert so duplicate and new-email requests both
    // pay the expensive password-hashing cost.
    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      const user = await this.usersService.create({
        email: input.email,
        passwordHash,
        roleName: REGISTRATION_ROLE,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          role: user.role.name,
          createdAt: user.createdAt,
        },
      };
    } catch (error: unknown) {
      if (isPrismaKnownRequestError(error, 'P2002')) {
        throw new ConflictException(
          'An account cannot be created with the supplied details',
        );
      }

      // A missing seeded customer role is deployment/configuration failure, not
      // a bad client request. Do not expose Prisma internals to the caller.
      if (isPrismaKnownRequestError(error, 'P2025')) {
        throw new ServiceUnavailableException(
          'Registration is temporarily unavailable',
        );
      }

      throw error;
    }
  }

  async login(
    input: LoginDto,
    context: LoginContext = {},
  ): Promise<LoginResult> {
    const user = await this.usersService.findActiveAuthenticationByEmail(
      input.email,
    );
    const passwordMatches = await this.passwordHasher.matches(
      input.password,
      user?.passwordHash ?? null,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (this.passwordHasher.needsRehash(user.passwordHash)) {
      const upgradedHash = await this.passwordHasher.hash(input.password);
      await this.usersService.updatePasswordHash(user.userId, upgradedHash);
    }

    const tokens = await this.authTokensService.issueForUser(
      user.userId,
      context.deviceInfo,
    );

    return {
      ...tokens,
      user: {
        id: user.userId,
        email: user.email,
        role: user.roleName,
        permissions: user.permissions,
      },
    };
  }

  async refresh(
    input: RefreshTokenDto,
    context: LoginContext = {},
  ): Promise<TokenPair> {
    const tokens = await this.authTokensService.rotate(
      input.refreshToken,
      context.deviceInfo,
    );

    if (!tokens) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return tokens;
  }

  async logout(input: RefreshTokenDto): Promise<void> {
    await this.authTokensService.revokeFamily(input.refreshToken);
  }
}
