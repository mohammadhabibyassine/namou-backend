import { Prisma } from '../generated/prisma/client.js';

export const CART_ITEM_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  createdAt: true,
  updatedAt: true,
  variant: {
    select: {
      sku: true,
      effectivePrice: true,
      stockQuantity: true,
      deletedAt: true,
      images: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { imageUrl: true },
      },
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          currencyCode: true,
          isActive: true,
          deletedAt: true,
          category: { select: { deletedAt: true } },
          images: {
            where: { variantId: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { imageUrl: true },
          },
        },
      },
      attributeValues: {
        orderBy: [{ attributeTypeId: 'asc' }],
        select: {
          productAttributeValue: {
            select: {
              attributeValue: {
                select: {
                  value: true,
                  attributeType: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

export type CartItemRecord = Prisma.CartItemGetPayload<{
  select: typeof CART_ITEM_SELECT;
}>;
