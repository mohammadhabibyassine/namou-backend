import type { JwtService } from '@nestjs/jwt';
import type { AuthConfiguration } from '../../config/auth.config.js';
import type { UsersService } from '../../users/users.service.js';
import { AccessTokenVerifier } from './access-token-verifier.js';

const payload = {
  sub: '11111111-1111-4111-8111-111111111111',
  jti: '22222222-2222-4222-8222-222222222222',
  iss: 'namou',
  aud: 'namou-api',
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

describe('AccessTokenVerifier', () => {
  const decode = vi.fn();
  const verifyAsync = vi.fn();
  const findActiveAuthorizationById = vi.fn();
  const jwt = { decode, verifyAsync } as unknown as JwtService;
  const users = {
    findActiveAuthorizationById,
  } as unknown as UsersService;
  const config = {
    accessToken: {
      secret: 'test-secret-that-is-at-least-thirty-two-characters',
      ttlSeconds: 900,
      issuer: 'namou',
      audience: 'namou-api',
    },
    refreshToken: { ttlDays: 30 },
  } as AuthConfiguration;
  const verifier = new AccessTokenVerifier(jwt, users, config);

  beforeEach(() => {
    vi.clearAllMocks();
    decode.mockReturnValue({ header: { alg: 'HS256', typ: 'at+jwt' } });
    verifyAsync.mockResolvedValue(payload);
  });

  it('verifies signature constraints and refreshes authorization from PostgreSQL', async () => {
    const actor = {
      userId: payload.sub,
      email: 'customer@example.com',
      roleId: '33333333-3333-4333-8333-333333333333',
      roleName: 'customer',
      permissions: ['view_orders'],
    };
    findActiveAuthorizationById.mockResolvedValue(actor);

    await expect(verifier.authenticate('token')).resolves.toEqual(actor);
    expect(verifyAsync).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        algorithms: ['HS256'],
        issuer: 'namou',
        audience: 'namou-api',
      }),
    );
  });

  it('rejects an access token with the wrong explicit JWT type', async () => {
    decode.mockReturnValue({ header: { alg: 'HS256', typ: 'JWT' } });

    await expect(verifier.authenticate('token')).resolves.toBeNull();
    expect(verifyAsync).not.toHaveBeenCalled();
  });
});
