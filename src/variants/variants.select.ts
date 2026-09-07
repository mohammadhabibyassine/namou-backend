import { Prisma } from '../generated/prisma/client.js';

export const ATTRIBUTE_TYPE_SELECT = {
  id: true,
  name: true,
  slug: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  values: {
    orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      value: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.AttributeTypeSelect;

export const ATTRIBUTE_VALUE_SELECT = {
  id: true,
  attributeTypeId: true,
  value: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttributeValueSelect;

export const ADMIN_VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  priceOverride: true,
  effectivePrice: true,
  stockQuantity: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  attributeValues: {
    orderBy: [{ attributeTypeId: 'asc' }],
    select: {
      attributeTypeId: true,
      attributeValueId: true,
    },
  },
} satisfies Prisma.ProductVariantSelect;

export const ADMIN_IMAGE_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  imageUrl: true,
  altText: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductImageSelect;

export type AttributeTypeRecord = Prisma.AttributeTypeGetPayload<{
  select: typeof ATTRIBUTE_TYPE_SELECT;
}>;

export type AttributeValueRecord = Prisma.AttributeValueGetPayload<{
  select: typeof ATTRIBUTE_VALUE_SELECT;
}>;

export type AdminVariantRecord = Prisma.ProductVariantGetPayload<{
  select: typeof ADMIN_VARIANT_SELECT;
}>;

export type AdminImageRecord = Prisma.ProductImageGetPayload<{
  select: typeof ADMIN_IMAGE_SELECT;
}>;
