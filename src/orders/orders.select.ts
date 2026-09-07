import { Prisma } from '../generated/prisma/client.js';

export const ORDER_SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  total: true,
  currencyCode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

export const ORDER_DETAIL_SELECT = {
  id: true,
  userId: true,
  orderNumber: true,
  status: true,
  subtotal: true,
  discountAmount: true,
  shippingCost: true,
  taxAmount: true,
  total: true,
  currencyCode: true,
  shippingRecipientName: true,
  shippingAddressLine1: true,
  shippingAddressLine2: true,
  shippingCity: true,
  shippingState: true,
  shippingPostalCode: true,
  shippingCountryCode: true,
  shippingPhone: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      productId: true,
      variantId: true,
      productTitle: true,
      variantLabel: true,
      sku: true,
      imageUrl: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      createdAt: true,
    },
  },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderSummaryRecord = Prisma.OrderGetPayload<{
  select: typeof ORDER_SUMMARY_SELECT;
}>;

export type OrderDetailRecord = Prisma.OrderGetPayload<{
  select: typeof ORDER_DETAIL_SELECT;
}>;
