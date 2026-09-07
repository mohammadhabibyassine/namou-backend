import { JwtService } from '@nestjs/jwt';
import type { AuthConfiguration } from '../../config/auth.config.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { hashRefreshToken } from './refresh-token.crypto.js';

describe('AuthTokensService', () => {
  const signAsync = vi.fn();
  const create = vi.fn();
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const update = vi.fn();
  const aggregate = vi.fn();
  const transaction = vi.fn();
  const queryRaw = vi.fn();
  const jwtService = { signAsync } as unknown as JwtService;
  const transactionClient = {
    $queryRaw: queryRaw,
    refreshToken: {
      create,
      findUnique,
      updateMany,
      update,
      aggregate,
    },
  };
  const prisma = {
    refreshToken: { create },
    $transaction: transaction,
  } as unknown as PrismaService;
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
  const service = new AuthTokensService(jwtService, prisma, config);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    signAsync.mockResolvedValue('signed-access-token');
    create.mockResolvedValue({ id: 'refresh-token-id' });
    queryRaw.mockResolvedValue([{ id: 'current-token-id' }]);
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue({ id: 'current-token-id' });
    aggregate.mockResolvedValue({
      _max: { createdAt: new Date('2025-12-31T00:00:00.000Z') },
    });
    transaction.mockImplementation(
      (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a minimal access token and persists only a refresh-token hash', async () => {
    const result = await service.issueForUser(
      'user-id',
      '  namou test client  ',
    );

    expect(signAsync).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        algorithm: 'HS256',
        subject: 'user-id',
        jwtid: expect.any(String),
        header: {
          alg: 'HS256',
          typ: 'at+jwt',
        },
      }),
    );
    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        tokenHash: hashRefreshToken(result.refreshToken),
        expiresAt: new Date('2026-01-31T00:00:00.000Z'),
        deviceInfo: 'namou test client',
      },
      select: {
        id: true,
      },
    });
    expect(create.mock.calls[0]?.[0].data.tokenHash).not.toBe(
      result.refreshToken,
    );
  });

  it('bounds untrusted device metadata before persistence', async () => {
    await service.issueForUser('user-id', ` ${'x'.repeat(600)} `);

    expect(create.mock.calls[0]?.[0].data.deviceInfo).toHaveLength(512);
  });

  it('atomically rotates a valid token without extending family expiry', async () => {
    const familyExpiry = new Date('2026-01-20T00:00:00.000Z');
    findUnique.mockResolvedValue({
      id: 'current-token-id',
      userId: 'user-id',
      tokenFamilyId: 'family-id',
      expiresAt: familyExpiry,
      revokedAt: null,
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
      deviceInfo: 'original client',
      user: {
        isActive: true,
        deletedAt: null,
      },
    });
    create.mockResolvedValue({ id: 'replacement-token-id' });

    const result = await service.rotate('a'.repeat(43), 'current client');

    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'current-token-id',
        revokedAt: null,
        expiresAt: { gt: new Date('2026-01-01T00:00:00.000Z') },
        user: {
          isActive: true,
          deletedAt: null,
        },
      },
      data: {
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        tokenHash: hashRefreshToken(result?.refreshToken ?? ''),
        tokenFamilyId: 'family-id',
        expiresAt: familyExpiry,
        deviceInfo: 'current client',
      },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'current-token-id' },
      data: { replacedByTokenId: 'replacement-token-id' },
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledBefore(create);
    expect(create).toHaveBeenCalledBefore(update);
  });

  it('commits family revocation when a rotated token is replayed', async () => {
    findUnique.mockResolvedValue({
      id: 'current-token-id',
      userId: 'user-id',
      tokenFamilyId: 'family-id',
      expiresAt: new Date('2026-01-20T00:00:00.000Z'),
      revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
      deviceInfo: null,
      user: {
        isActive: true,
        deletedAt: null,
      },
    });

    await expect(service.rotate('a'.repeat(43))).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: 'family-id',
        revokedAt: null,
      },
      data: {
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('treats a lost conditional update as replay and revokes the family', async () => {
    findUnique.mockResolvedValue({
      id: 'current-token-id',
      userId: 'user-id',
      tokenFamilyId: 'family-id',
      expiresAt: new Date('2026-01-20T00:00:00.000Z'),
      revokedAt: null,
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
      deviceInfo: null,
      user: {
        isActive: true,
        deletedAt: null,
      },
    });
    updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.rotate('a'.repeat(43))).resolves.toBeNull();
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        tokenFamilyId: 'family-id',
        revokedAt: null,
      },
      data: {
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes the whole family on logout and is idempotent for unknown tokens', async () => {
    findUnique.mockResolvedValueOnce({ tokenFamilyId: 'family-id' });

    await service.revokeFamily('a'.repeat(43));

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: 'family-id',
        revokedAt: null,
      },
      data: {
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    vi.clearAllMocks();
    transaction.mockImplementation(
      (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    );
    findUnique.mockResolvedValueOnce(null);

    await expect(service.revokeFamily('b'.repeat(43))).resolves.toBeUndefined();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
