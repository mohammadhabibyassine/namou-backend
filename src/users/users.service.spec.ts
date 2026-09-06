import type { PrismaService } from '../prisma/prisma.service.js';
import { USER_PROFILE_SELECT } from './users.select.js';
import { UsersService } from './users.service.js';

const authorizationRecord = {
  id: 'user-id',
  email: 'customer@example.com',
  role: {
    id: 'role-id',
    name: 'customer',
    permissions: [
      {
        permission: {
          name: 'view_orders',
        },
      },
    ],
  },
};

describe('UsersService', () => {
  const findUnique = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const queryRaw = vi.fn();
  const addressFindMany = vi.fn();
  const addressUpdate = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    userAddress: {
      findMany: addressFindMany,
      update: addressUpdate,
    },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    user: {
      findUnique,
      create,
      update,
    },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new UsersService(prisma);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes email and returns authentication data with permissions', async () => {
    findUnique.mockResolvedValue({
      ...authorizationRecord,
      passwordHash: 'argon2-hash',
    });

    await expect(
      service.findActiveAuthenticationByEmail(' Customer@Example.COM '),
    ).resolves.toEqual({
      userId: 'user-id',
      email: 'customer@example.com',
      passwordHash: 'argon2-hash',
      roleId: 'role-id',
      roleName: 'customer',
      permissions: ['view_orders'],
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: 'customer@example.com',
          isActive: true,
          deletedAt: null,
        },
      }),
    );
  });

  it('returns null when no active user matches', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.findActiveAuthorizationById('missing-user'),
    ).resolves.toBeNull();
  });

  it('creates a user through the checked role relation', async () => {
    create.mockResolvedValue({ id: 'user-id' });

    await service.create({
      email: ' NEW@Example.com ',
      passwordHash: 'argon2-hash',
      roleName: 'customer',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        email: 'new@example.com',
        passwordHash: 'argon2-hash',
        firstName: undefined,
        lastName: undefined,
        phone: undefined,
        role: {
          connect: {
            name: 'customer',
          },
        },
      },
      select: USER_PROFILE_SELECT,
    });
  });

  it('never includes passwordHash in the profile projection', () => {
    expect(USER_PROFILE_SELECT).not.toHaveProperty('passwordHash');
  });

  it('updates only the password hash and returns no user data', async () => {
    update.mockResolvedValue({ id: 'user-id' });

    await expect(
      service.updatePasswordHash('user-id', 'upgraded-hash'),
    ).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { passwordHash: 'upgraded-hash' },
      select: { id: true },
    });
  });

  it('promotes the oldest remaining address when deleting the default', async () => {
    const defaultAddressId = 'eef702a8-4954-4c71-a747-a5179113b82e';
    const replacementAddressId = 'ef976445-6be6-4eb4-879b-3f312baf5fbc';
    queryRaw.mockResolvedValueOnce([{ id: authorizationRecord.id }]);
    addressFindMany.mockResolvedValueOnce([
      { id: defaultAddressId, isDefault: true },
      { id: replacementAddressId, isDefault: false },
    ]);
    addressUpdate.mockResolvedValue({ id: defaultAddressId });

    await service.deleteAddress(authorizationRecord.id, defaultAddressId);

    expect(addressUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: defaultAddressId,
          userId: authorizationRecord.id,
          deletedAt: null,
        },
        data: { deletedAt: expect.any(Date), isDefault: false },
      }),
    );
    expect(addressUpdate).toHaveBeenNthCalledWith(2, {
      where: {
        id: replacementAddressId,
        userId: authorizationRecord.id,
        deletedAt: null,
      },
      data: { isDefault: true },
      select: { id: true },
    });
  });
});
