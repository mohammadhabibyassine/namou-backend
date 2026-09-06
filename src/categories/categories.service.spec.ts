import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ApplicationCacheService } from '../cache/application-cache.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CategoriesService } from './categories.service.js';
import type { CategoryTreeRow } from './categories.types.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-01T00:00:00.000Z');

function knownRequestError(
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Database request failed', {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}

function triggerError(message: string): Prisma.PrismaClientKnownRequestError {
  return knownRequestError('P2039', {
    driverAdapterError: {
      cause: {
        originalCode: 'P0001',
        originalMessage: message,
      },
    },
  });
}

describe('CategoriesService', () => {
  const remember = vi.fn(
    async (
      _namespace: string,
      _key: string,
      _ttl: number,
      loader: () => Promise<unknown>,
    ) => loader(),
  );
  const invalidate = vi.fn();
  const cache = { remember, invalidate } as unknown as ApplicationCacheService;
  const queryRaw = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const findUnique = vi.fn();
  const prisma = {
    $queryRaw: queryRaw,
    category: {
      create,
      update,
      findUnique,
    },
  } as unknown as PrismaService;
  const service = new CategoriesService(prisma, cache);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds an unlimited-depth nested forest from recursive query rows', async () => {
    const rows: CategoryTreeRow[] = [
      {
        id: 'root-id',
        parentId: null,
        name: 'Clothing',
        slug: 'clothing',
        description: null,
        sortOrder: 0,
        depth: 0,
      },
      {
        id: 'child-id',
        parentId: 'root-id',
        name: 'Shoes',
        slug: 'shoes',
        description: null,
        sortOrder: 0,
        depth: 1,
      },
      {
        id: 'grandchild-id',
        parentId: 'child-id',
        name: 'Boots',
        slug: 'boots',
        description: null,
        sortOrder: 0,
        depth: 2,
      },
    ];
    queryRaw.mockResolvedValue(rows);

    const tree = await service.findTree();

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.children[0]).toMatchObject({
      id: 'grandchild-id',
      children: [],
    });
  });

  it('returns not found when the recursive subtree function has no active root', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(service.findSubtree('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('normalizes values and connects only to an active parent on creation', async () => {
    create.mockResolvedValue({
      id: 'category-id',
      parentId: 'parent-id',
      name: 'Shoes',
      slug: 'shoes',
      description: null,
      sortOrder: 0,
      createdAt,
      updatedAt,
    });

    await service.create({
      name: '  Shoes  ',
      slug: '  SHOES  ',
      parentId: 'parent-id',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Shoes',
          slug: 'shoes',
          parent: {
            connect: {
              id: 'parent-id',
              deletedAt: null,
            },
          },
        }),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith('categories', 'product-catalog');
  });

  it('rejects an empty PATCH before issuing a database query', async () => {
    await expect(service.update('category-id', {})).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'At least one category field is required',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('maps case-insensitive slug conflicts to an HTTP conflict', async () => {
    create.mockRejectedValue(knownRequestError('P2002'));

    await expect(
      service.create({ name: 'Shoes', slug: 'shoes' }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Category slug is already in use',
    });
  });

  it('maps database-detected hierarchy cycles to a safe client error', async () => {
    update.mockRejectedValue(
      triggerError('Category parent change would create a cycle'),
    );

    await expect(
      service.update('category-id', { parentId: 'descendant-id' }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'Invalid category parent',
    });
  });

  it('distinguishes an invalid nested parent from a missing update target', async () => {
    update.mockRejectedValue(knownRequestError('P2025'));
    findUnique.mockResolvedValueOnce({ id: 'category-id' });

    await expect(
      service.update('category-id', { parentId: 'missing-parent-id' }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'Parent category must exist and be active',
    });

    findUnique.mockResolvedValueOnce(null);
    await expect(
      service.update('missing-id', { parentId: 'parent-id' }),
    ).rejects.toMatchObject({
      constructor: NotFoundException,
      message: 'Category not found',
    });
  });

  it('maps trigger-protected soft-delete dependencies to a conflict', async () => {
    update.mockRejectedValue(
      triggerError(
        'Cannot soft-delete category category-id while it has active child categories',
      ),
    );

    await expect(service.softDelete('category-id')).rejects.toMatchObject({
      constructor: ConflictException,
      message:
        'Category must have no active children or products before deletion',
    });
  });
});
