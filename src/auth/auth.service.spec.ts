import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { PasswordHasher } from './password/password-hasher.js';
import type { AuthTokensService } from './tokens/auth-tokens.service.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-01T00:00:00.000Z');

describe('AuthService', () => {
  const create = vi.fn();
  const findActiveAuthenticationByEmail = vi.fn();
  const updatePasswordHash = vi.fn();
  const hash = vi.fn();
  const matches = vi.fn();
  const needsRehash = vi.fn();
  const issueForUser = vi.fn();
  const rotate = vi.fn();
  const revokeFamily = vi.fn();
  const usersService = {
    create,
    findActiveAuthenticationByEmail,
    updatePasswordHash,
  } as unknown as UsersService;
  const passwordHasher = {
    hash,
    matches,
    needsRehash,
  } as unknown as PasswordHasher;
  const authTokensService = {
    issueForUser,
    rotate,
    revokeFamily,
  } as unknown as AuthTokensService;
  const service = new AuthService(
    usersService,
    passwordHasher,
    authTokensService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    hash.mockResolvedValue('argon2-hash');
    matches.mockResolvedValue(true);
    needsRehash.mockReturnValue(false);
    issueForUser.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    rotate.mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    revokeFamily.mockResolvedValue(undefined);
  });

  it('hashes the password and registers a customer with a safe response', async () => {
    create.mockResolvedValue({
      id: 'user-id',
      email: 'customer@example.com',
      firstName: 'Ada',
      lastName: null,
      phone: null,
      isActive: true,
      emailVerifiedAt: null,
      createdAt,
      updatedAt,
      role: {
        id: 'role-id',
        name: 'customer',
      },
    });

    await expect(
      service.register({
        email: 'customer@example.com',
        password: 'a long registration password',
        firstName: 'Ada',
      }),
    ).resolves.toEqual({
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        firstName: 'Ada',
        lastName: null,
        phone: null,
        role: 'customer',
        createdAt,
      },
    });
    expect(hash).toHaveBeenCalledWith('a long registration password');
    expect(create).toHaveBeenCalledWith({
      email: 'customer@example.com',
      passwordHash: 'argon2-hash',
      roleName: 'customer',
      firstName: 'Ada',
      lastName: undefined,
      phone: undefined,
    });
  });

  it('maps a unique-email race to a generic conflict response', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const registration = service.register({
      email: 'customer@example.com',
      password: 'a long registration password',
    });

    await expect(registration).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'An account cannot be created with the supplied details',
    });
    expect(hash).toHaveBeenCalledBefore(create);
  });

  it('hides a missing seeded role behind a service-level error', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const registration = service.register({
      email: 'customer@example.com',
      password: 'a long registration password',
    });

    await expect(registration).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('authenticates an active user and issues a token pair', async () => {
    findActiveAuthenticationByEmail.mockResolvedValue({
      userId: 'user-id',
      email: 'customer@example.com',
      passwordHash: 'current-argon2-hash',
      roleId: 'role-id',
      roleName: 'customer',
      permissions: ['view_orders'],
    });

    await expect(
      service.login(
        {
          email: 'customer@example.com',
          password: 'a long password',
        },
        { deviceInfo: 'test client' },
      ),
    ).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: 'user-id',
        email: 'customer@example.com',
        role: 'customer',
        permissions: ['view_orders'],
      },
    });
    expect(matches).toHaveBeenCalledWith(
      'a long password',
      'current-argon2-hash',
    );
    expect(issueForUser).toHaveBeenCalledWith('user-id', 'test client');
    expect(updatePasswordHash).not.toHaveBeenCalled();
  });

  it('uses dummy password verification and returns the same error for an unknown email', async () => {
    findActiveAuthenticationByEmail.mockResolvedValue(null);
    matches.mockResolvedValue(false);

    const login = service.login({
      email: 'missing@example.com',
      password: 'some password',
    });

    await expect(login).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: 'Invalid email or password',
    });
    expect(matches).toHaveBeenCalledWith('some password', null);
    expect(issueForUser).not.toHaveBeenCalled();
  });

  it('returns the same error for an incorrect password', async () => {
    findActiveAuthenticationByEmail.mockResolvedValue({
      userId: 'user-id',
      email: 'customer@example.com',
      passwordHash: 'current-argon2-hash',
      roleId: 'role-id',
      roleName: 'customer',
      permissions: ['view_orders'],
    });
    matches.mockResolvedValue(false);

    await expect(
      service.login({
        email: 'customer@example.com',
        password: 'wrong password',
      }),
    ).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: 'Invalid email or password',
    });
    expect(issueForUser).not.toHaveBeenCalled();
  });

  it('upgrades an outdated password hash before issuing tokens', async () => {
    findActiveAuthenticationByEmail.mockResolvedValue({
      userId: 'user-id',
      email: 'customer@example.com',
      passwordHash: 'legacy-hash',
      roleId: 'role-id',
      roleName: 'customer',
      permissions: ['view_orders'],
    });
    needsRehash.mockReturnValue(true);
    hash.mockResolvedValue('upgraded-argon2-hash');

    await service.login({
      email: 'customer@example.com',
      password: 'legacy password',
    });

    expect(hash).toHaveBeenCalledWith('legacy password');
    expect(updatePasswordHash).toHaveBeenCalledWith(
      'user-id',
      'upgraded-argon2-hash',
    );
    expect(updatePasswordHash).toHaveBeenCalledBefore(issueForUser);
  });

  it('rotates a valid refresh token', async () => {
    await expect(
      service.refresh(
        { refreshToken: 'presented-refresh-token' },
        { deviceInfo: 'test client' },
      ),
    ).resolves.toEqual({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(rotate).toHaveBeenCalledWith(
      'presented-refresh-token',
      'test client',
    );
  });

  it('maps an invalid refresh token to a generic unauthorized response', async () => {
    rotate.mockResolvedValue(null);

    await expect(
      service.refresh({ refreshToken: 'invalid-refresh-token' }),
    ).rejects.toMatchObject({
      constructor: UnauthorizedException,
      message: 'Invalid refresh token',
    });
  });

  it('logs out by revoking the token family', async () => {
    await expect(
      service.logout({ refreshToken: 'presented-refresh-token' }),
    ).resolves.toBeUndefined();
    expect(revokeFamily).toHaveBeenCalledWith('presented-refresh-token');
  });
});
