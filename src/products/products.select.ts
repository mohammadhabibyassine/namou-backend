import { Prisma } from '../generated/prisma/client.js';

export const PRODUCT_ADMIN_SELECT = {
  id: true,
  categoryId: true,
  title: true,
  slug: true,
  description: true,
  basePrice: true,
  currencyCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type ProductAdminRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_ADMIN_SELECT;
}>;

export const PRODUCT_DETAIL_SELECT = {
  id: true,
  title: true,
  slug: true,
  description: true,
  basePrice: true,
  currencyCode: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      variantId: true,
      imageUrl: true,
      altText: true,
      sortOrder: true,
    },
  },
  attributeTypes: {
    orderBy: [{ sortOrder: 'asc' }, { attributeTypeId: 'asc' }],
    select: {
      sortOrder: true,
      attributeType: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      attributeValues: {
        orderBy: [
          { attributeValue: { sortOrder: 'asc' } },
          { attributeValueId: 'asc' },
        ],
        select: {
          attributeValue: {
            select: {
              id: true,
              value: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  },
  variants: {
    where: {
      deletedAt: null,
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      sku: true,
      priceOverride: true,
      effectivePrice: true,
      stockQuantity: true,
      isDefault: true,
      attributeValues: {
        orderBy: [{ attributeTypeId: 'asc' }],
        select: {
          attributeTypeId: true,
          attributeValueId: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductDetailRecord = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_DETAIL_SELECT;
}>;
