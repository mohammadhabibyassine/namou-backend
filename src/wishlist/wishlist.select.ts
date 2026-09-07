import { Prisma } from '../generated/prisma/client.js';

export const WISHLIST_ITEM_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  createdAt: true,
  updatedAt: true,
  product: {
    select: {
      title: true,
      slug: true,
      basePrice: true,
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
    },
  },
} satisfies Prisma.WishlistItemSelect;

export type WishlistItemRecord = Prisma.WishlistItemGetPayload<{
  select: typeof WISHLIST_ITEM_SELECT;
}>;
