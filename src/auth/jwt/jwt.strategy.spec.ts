import { UnauthorizedException } from '@nestjs/common';
import type { AuthConfiguration } from '../../config/auth.config.js';
import type { UsersService } from '../../users/users.service.js';
import { JwtStrategy } from './jwt.strategy.js';

const config = {
  accessToken: {
    secret: 'test-secret-that-is-at-least-thirty-two-characters',
    ttlSeconds: 900,
    issuer: 'namou',
    audience: 'namou-api',
  },
  refreshToken: {
    ttlDays: 30,
  },
} as AuthConfiguration;

const validPayload = {
  sub: '11111111-1111-4111-8111-111111111111',
  jti: '22222222-2222-4222-8222-222222222222',
  iss: 'namou',
  aud: 'namou-api',
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

describe('JwtStrategy', () => {
  const findActiveAuthorizationById = vi.fn();
  const usersService = {
    findActiveAuthorizationById,
  } as unknown as UsersService;
  const strategy = new JwtStrategy(config, usersService);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns current database-backed authorization for a valid subject', async () => {
    const authorization = {
      userId: validPayload.sub,
      email: 'customer@example.com',
      roleId: '33333333-3333-4333-8333-333333333333',
      roleName: 'customer',
      permissions: ['view_orders'],
    };
    findActiveAuthorizationById.mockResolvedValue(authorization);

    await expect(strategy.validate(validPayload)).resolves.toEqual(
      authorization,
    );
    expect(findActiveAuthorizationById).toHaveBeenCalledWith(validPayload.sub);
  });

  it('rejects malformed claims before querying the database', async () => {
    await expect(
      strategy.validate({ ...validPayload, sub: 'invalid' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findActiveAuthorizationById).not.toHaveBeenCalled();
  });

  it('rejects inactive, deleted, or missing subjects', async () => {
    findActiveAuthorizationById.mockResolvedValue(null);

    await expect(strategy.validate(validPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
