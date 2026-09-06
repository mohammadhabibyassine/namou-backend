import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ApplicationCacheService } from '../cache/application-cache.service.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import { ProductsAdminService } from './products-admin.service.js';

const categoryId = '27ef665b-082b-4a66-8c40-a256cf7966b1';
const colorTypeId = 'eef702a8-4954-4c71-a747-a5179113b82e';
const redValueId = 'ef976445-6be6-4eb4-879b-3f312baf5fbc';
const blueValueId = 'e23c6a73-aeeb-41e9-baa5-b8709d49ce72';

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

function productInput(
  overrides: Partial<CreateProductDto> = {},
): CreateProductDto {
  return {
    categoryId,
    title: '  Everyday trainer  ',
    slug: 'everyday-trainer',
    description: null,
    basePrice: '89.90',
    currencyCode: 'USD',
    isActive: true,
    attributes: [],
    variants: [
      {
        sku: ' trainer-default ',
        priceOverride: null,
        stockQuantity: 12,
        isDefault: true,
        options: [],
      },
    ],
    images: [
      {
        imageUrl: 'products/trainer/main.webp',
        altText: 'Everyday trainer',
        sortOrder: 0,
        variantSku: ' TRAINER-DEFAULT ',
      },
    ],
    ...overrides,
  };
}

describe('ProductsAdminService', () => {
  const invalidate = vi.fn();
  const cache = { invalidate } as unknown as ApplicationCacheService;
  const queryRaw = vi.fn();
  const productCreate = vi.fn();
  const productUpdate = vi.fn();
  const attributeTypeFindMany = vi.fn();
  const attributeValueFindMany = vi.fn();
  const productAttributeTypeCreateMany = vi.fn();
  const productAttributeValueCreateMany = vi.fn();
  const productVariantCreateManyAndReturn = vi.fn();
  const productVariantUpdateMany = vi.fn();
  const variantAttributeValueCreateMany = vi.fn();
  const productImageCreateMany = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    product: { create: productCreate, update: productUpdate },
    attributeType: { findMany: attributeTypeFindMany },
    attributeValue: { findMany: attributeValueFindMany },
    productAttributeType: { createMany: productAttributeTypeCreateMany },
    productAttributeValue: { createMany: productAttributeValueCreateMany },
    productVariant: {
      createManyAndReturn: productVariantCreateManyAndReturn,
      updateMany: productVariantUpdateMany,
    },
    variantAttributeValue: { createMany: variantAttributeValueCreateMany },
    productImage: { createMany: productImageCreateMany },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new ProductsAdminService(prisma, cache);

  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockResolvedValue([{ id: categoryId }]);
    productCreate.mockResolvedValue({
      id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
      slug: 'everyday-trainer',
    });
    productVariantCreateManyAndReturn.mockResolvedValue([
      {
        id: '8eac816f-9119-42e7-b784-f16623aad3d0',
        sku: 'TRAINER-DEFAULT',
      },
    ]);
    productUpdate.mockResolvedValue({
      id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
      categoryId,
      title: 'Renamed trainer',
      slug: 'renamed-trainer',
      description: null,
      basePrice: new Prisma.Decimal('95.5'),
      currencyCode: 'EUR',
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    productVariantUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('creates a stock-owning default variant and resolves image links atomically', async () => {
    await expect(service.create(productInput())).resolves.toEqual({
      id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
      slug: 'everyday-trainer',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 10_000,
    });
    expect(productCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Everyday trainer',
          slug: 'everyday-trainer',
          basePrice: '89.90',
        }),
      }),
    );
    expect(productVariantCreateManyAndReturn).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sku: 'TRAINER-DEFAULT',
          priceOverride: null,
          effectivePrice: '89.90',
          stockQuantity: 12,
          isDefault: true,
        }),
      ],
      select: { id: true, sku: true },
    });
    expect(productImageCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          variantId: '8eac816f-9119-42e7-b784-f16623aad3d0',
          imageUrl: 'products/trainer/main.webp',
        }),
      ],
    });
    expect(productAttributeTypeCreateMany).not.toHaveBeenCalled();
    expect(variantAttributeValueCreateMany).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith('product-catalog');
  });

  it('infers offered values from variant combinations and bulk persists them', async () => {
    attributeTypeFindMany.mockResolvedValue([{ id: colorTypeId }]);
    attributeValueFindMany.mockResolvedValue([
      { id: redValueId, attributeTypeId: colorTypeId },
      { id: blueValueId, attributeTypeId: colorTypeId },
    ]);
    productVariantCreateManyAndReturn.mockResolvedValue([
      {
        id: '7d9ecff8-bc40-49ae-9289-1a29c4dfe65b',
        sku: 'TRAINER-RED',
      },
      {
        id: 'd5742f11-5880-4162-85c4-32d24e78cf14',
        sku: 'TRAINER-BLUE',
      },
    ]);

    await service.create(
      productInput({
        attributes: [{ attributeTypeId: colorTypeId, sortOrder: 0 }],
        variants: [
          {
            sku: 'trainer-red',
            priceOverride: '94.90',
            stockQuantity: 5,
            isDefault: true,
            options: [
              { attributeTypeId: colorTypeId, attributeValueId: redValueId },
            ],
          },
          {
            sku: 'trainer-blue',
            priceOverride: null,
            stockQuantity: 7,
            isDefault: false,
            options: [
              { attributeTypeId: colorTypeId, attributeValueId: blueValueId },
            ],
          },
        ],
        images: [],
      }),
    );

    expect(productAttributeValueCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          attributeTypeId: colorTypeId,
          attributeValueId: redValueId,
        }),
        expect.objectContaining({
          attributeTypeId: colorTypeId,
          attributeValueId: blueValueId,
        }),
      ]),
    });
    expect(variantAttributeValueCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          variantId: '7d9ecff8-bc40-49ae-9289-1a29c4dfe65b',
          attributeValueId: redValueId,
        }),
        expect.objectContaining({
          variantId: 'd5742f11-5880-4162-85c4-32d24e78cf14',
          attributeValueId: blueValueId,
        }),
      ]),
    });
  });

  it.each([
    {
      name: 'multiple variants without attributes',
      input: productInput({
        variants: [
          ...productInput().variants,
          {
            sku: 'SECOND',
            priceOverride: null,
            stockQuantity: 1,
            isDefault: false,
            options: [],
          },
        ],
      }),
      message: 'A product without attributes must have exactly one variant',
    },
    {
      name: 'no default variant',
      input: productInput({
        variants: [
          {
            ...productInput().variants[0]!,
            isDefault: false,
          },
        ],
      }),
      message: 'A product must have exactly one default variant',
    },
    {
      name: 'case-insensitive duplicate SKUs',
      input: productInput({
        attributes: [{ attributeTypeId: colorTypeId, sortOrder: 0 }],
        variants: [
          {
            sku: 'red-sku',
            priceOverride: null,
            stockQuantity: 1,
            isDefault: true,
            options: [
              { attributeTypeId: colorTypeId, attributeValueId: redValueId },
            ],
          },
          {
            sku: ' RED-SKU ',
            priceOverride: null,
            stockQuantity: 1,
            isDefault: false,
            options: [
              { attributeTypeId: colorTypeId, attributeValueId: blueValueId },
            ],
          },
        ],
      }),
      message: 'Variant SKUs must be unique',
    },
    {
      name: 'duplicate attribute combinations',
      input: productInput({
        attributes: [{ attributeTypeId: colorTypeId, sortOrder: 0 }],
        variants: [
          {
            sku: 'FIRST-RED',
            priceOverride: null,
            stockQuantity: 1,
            isDefault: true,
            options: [
              {
                attributeTypeId: colorTypeId,
                attributeValueId: redValueId,
              },
            ],
          },
          {
            sku: 'SECOND-RED',
            priceOverride: null,
            stockQuantity: 1,
            isDefault: false,
            options: [
              {
                attributeTypeId: colorTypeId,
                attributeValueId: redValueId,
              },
            ],
          },
        ],
      }),
      message: 'Variant attribute combinations must be unique',
    },
    {
      name: 'duplicate image positions',
      input: productInput({
        images: [
          ...productInput().images,
          {
            imageUrl: 'products/trainer/second.webp',
            altText: null,
            sortOrder: 0,
          },
        ],
      }),
      message: 'Product image sort orders must be unique',
    },
    {
      name: 'an unknown image SKU',
      input: productInput({
        images: [
          {
            imageUrl: 'products/trainer/main.webp',
            altText: null,
            sortOrder: 0,
            variantSku: 'unknown-sku',
          },
        ],
      }),
      message: 'Every image variantSku must reference a submitted variant',
    },
  ])(
    'rejects $name before opening a transaction',
    async ({ input, message }) => {
      await expect(service.create(input)).rejects.toMatchObject({
        constructor: BadRequestException,
        message,
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects an option value that belongs to a different type', async () => {
    attributeTypeFindMany.mockResolvedValue([{ id: colorTypeId }]);
    attributeValueFindMany.mockResolvedValue([
      {
        id: redValueId,
        attributeTypeId: '450d6587-3978-42f7-8c23-b8dcd179f94b',
      },
    ]);

    await expect(
      service.create(
        productInput({
          attributes: [{ attributeTypeId: colorTypeId, sortOrder: 0 }],
          variants: [
            {
              sku: 'TRAINER-RED',
              priceOverride: null,
              stockQuantity: 1,
              isDefault: true,
              options: [
                { attributeTypeId: colorTypeId, attributeValueId: redValueId },
              ],
            },
          ],
          images: [],
        }),
      ),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message:
        'Every option must reference a value belonging to its attribute type',
    });
    expect(productCreate).not.toHaveBeenCalled();
  });

  it('maps database uniqueness and deferred trigger failures to API errors', async () => {
    transaction.mockRejectedValueOnce(knownRequestError('P2002'));
    await expect(service.create(productInput())).rejects.toBeInstanceOf(
      ConflictException,
    );

    transaction.mockRejectedValueOnce(
      triggerError(
        'Active product product-id must have exactly one active default variant',
      ),
    );
    await expect(service.create(productInput())).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'Invalid product variant configuration',
    });
  });

  it('patches only supplied metadata and formats the admin response', async () => {
    await expect(
      service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {
        title: '  Renamed trainer  ',
        slug: ' RENAMED-TRAINER ',
        basePrice: '95.5',
        currencyCode: ' eur ',
      }),
    ).resolves.toMatchObject({
      id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
      slug: 'renamed-trainer',
      basePrice: '95.50',
    });

    expect(productUpdate).toHaveBeenCalledWith({
      where: {
        id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
        deletedAt: null,
      },
      data: {
        categoryId: undefined,
        title: 'Renamed trainer',
        slug: 'renamed-trainer',
        description: undefined,
        basePrice: '95.5',
        currencyCode: 'EUR',
        isActive: undefined,
      },
      select: expect.any(Object),
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('locks a new category before reassigning a product', async () => {
    await service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {
      categoryId,
    });

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(productUpdate).toHaveBeenCalledOnce();

    queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {
        categoryId,
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'Category must exist and be active',
    });
  });

  it('rejects an empty patch without opening a transaction', async () => {
    await expect(
      service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {}),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'At least one product field is required',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps missing products and slug conflicts during update', async () => {
    transaction.mockRejectedValueOnce(knownRequestError('P2025'));
    await expect(
      service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {
        title: 'Renamed trainer',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    transaction.mockRejectedValueOnce(knownRequestError('P2002'));
    await expect(
      service.update('046b61d4-dc6b-46b0-a935-54ac59d0f98b', {
        slug: 'taken-slug',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'Product slug is already in use',
    });
  });

  it('soft-deletes the product and all active variants in one transaction', async () => {
    await service.softDelete('046b61d4-dc6b-46b0-a935-54ac59d0f98b');

    expect(productVariantUpdateMany).toHaveBeenCalledWith({
      where: {
        productId: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    });
    expect(productUpdate).toHaveBeenCalledWith({
      where: {
        id: '046b61d4-dc6b-46b0-a935-54ac59d0f98b',
        deletedAt: null,
      },
      data: {
        isActive: false,
        deletedAt: expect.any(Date),
      },
      select: { id: true },
    });
    expect(productVariantUpdateMany.mock.calls[0]?.[0].data.deletedAt).toBe(
      productUpdate.mock.calls[0]?.[0].data.deletedAt,
    );
  });

  it('returns not found when a product is already deleted', async () => {
    queryRaw.mockResolvedValueOnce([]);

    await expect(
      service.softDelete('046b61d4-dc6b-46b0-a935-54ac59d0f98b'),
    ).rejects.toMatchObject({
      constructor: NotFoundException,
      message: 'Product not found',
    });
    expect(productVariantUpdateMany).not.toHaveBeenCalled();
  });
});
