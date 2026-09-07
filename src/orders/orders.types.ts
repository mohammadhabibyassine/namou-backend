import type { OrderStatus } from '../generated/prisma/enums.js';

export interface OrderSummaryView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  total: string;
  currencyCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderDetailView {
  id: string;
  userId: string;
  orderNumber: string;
  status: OrderStatus;
  subtotal: string;
  discountAmount: string;
  shippingCost: string;
  taxAmount: string;
  total: string;
  currencyCode: string;
  shippingAddress: {
    recipientName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string;
    countryCode: string;
    phone: string | null;
  };
  notes: string | null;
  items: Array<{
    id: string;
    productId: string;
    variantId: string;
    productTitle: string;
    variantLabel: string | null;
    sku: string;
    imageUrl: string | null;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
    createdAt: Date;
  }>;
  statusHistory: Array<{
    id: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}
