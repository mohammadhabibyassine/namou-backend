import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { OrderStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OrderJobsService } from '../jobs/order-jobs.service.js';
import type { ApplicationCacheService } from '../cache/application-cache.service.js';
import { OrdersService } from './orders.service.js';

const userId = '27ef665b-082b-4a66-8c40-a256cf7966b1';
const firstOrderId = 'eef702a8-4954-4c71-a747-a5179113b82e';
const secondOrderId = 'ef976445-6be6-4eb4-879b-3f312baf5fbc';
const variantId = 'e23c6a73-aeeb-41e9-baa5-b8709d49ce72';
const addressId = '046b61d4-dc6b-46b0-a935-54ac59d0f98b';

function summary(id: string) {
  return {
    id,
    orderNumber: `ORD-${id.slice(0, 8)}`,
    status: OrderStatus.pending,
    total: new Prisma.Decimal('25'),
    currencyCode: 'USD',
    createdAt: new Date('2026-09-06T10:20:30.123Z'),
    updatedAt: new Date('2026-09-06T10:20:30.123Z'),
  };
}

function detail(status = OrderStatus.cancelled) {
  const timestamp = new Date('2026-09-06T10:20:30.123Z');
  return {
    id: firstOrderId,
    userId,
    orderNumber: 'ORD-TEST',
    status,
    subtotal: new Prisma.Decimal('25'),
    discountAmount: new Prisma.Decimal('0'),
    shippingCost: new Prisma.Decimal('0'),
    taxAmount: new Prisma.Decimal('0'),
    total: new Prisma.Decimal('25'),
    currencyCode: 'USD',
    shippingRecipientName: 'Maya Customer',
    shippingAddressLine1: '1 Test Street',
    shippingAddressLine2: null,
    shippingCity: 'Beirut',
    shippingState: null,
    shippingPostalCode: '1107',
    shippingCountryCode: 'LB',
    shippingPhone: null,
    notes: null,
    items: [],
    statusHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function triggerError(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Database request failed', {
    code: 'P2010',
    clientVersion: Prisma.prismaVersion.client,
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: 'P0001',
          originalMessage: message,
        },
      },
    },
  });
}

describe('OrdersService', () => {
  const enqueueConfirmation = vi.fn();
  const jobs = { enqueueConfirmation } as unknown as OrderJobsService;
  const invalidate = vi.fn();
  const cache = { invalidate } as unknown as ApplicationCacheService;
  const orderFindMany = vi.fn();
  const orderFindUnique = vi.fn();
  const queryRaw = vi.fn();
  const orderUpdate = vi.fn();
  const productVariantUpdate = vi.fn();
  const orderItemFindMany = vi.fn();
  const cartItemDeleteMany = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    order: { update: orderUpdate },
    orderItem: { findMany: orderItemFindMany },
    productVariant: { update: productVariantUpdate },
    cartItem: { deleteMany: cartItemDeleteMany },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  const prisma = {
    order: { findMany: orderFindMany, findUnique: orderFindUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new OrdersService(prisma, jobs, cache);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paginates from the unique order ID without serializing Date precision', async () => {
    orderFindMany
      .mockResolvedValueOnce([summary(firstOrderId), summary(secondOrderId)])
      .mockResolvedValueOnce([summary(secondOrderId)]);

    const firstPage = await service.findOwnPage(userId, {
      pageSize: 1,
      status: OrderStatus.pending,
    });
    await service.findOwnPage(userId, {
      pageSize: 1,
      status: OrderStatus.pending,
      cursor: firstPage.pageInfo.endCursor ?? undefined,
    });

    expect(orderFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId, status: OrderStatus.pending },
        cursor: { id: firstOrderId },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('rejects a cursor reused with another status filter', async () => {
    orderFindMany.mockResolvedValueOnce([summary(firstOrderId)]);
    const firstPage = await service.findOwnPage(userId, {
      pageSize: 20,
      status: OrderStatus.pending,
    });

    await expect(
      service.findOwnPage(userId, {
        pageSize: 20,
        status: OrderStatus.confirmed,
        cursor: firstPage.pageInfo.endCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderFindMany).toHaveBeenCalledOnce();
  });

  it('rejects an invalid order transition before changing stock or status', async () => {
    queryRaw.mockResolvedValue([
      { id: firstOrderId, status: OrderStatus.delivered },
    ]);

    await expect(
      service.updateStatus(firstOrderId, OrderStatus.cancelled),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderItemFindMany).not.toHaveBeenCalled();
    expect(productVariantUpdate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects an empty cart before invoking the order function', async () => {
    queryRaw.mockResolvedValueOnce([{ id: userId }]).mockResolvedValueOnce([]);

    await expect(
      service.checkout(userId, { addressId }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(cartItemDeleteMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      databaseMessage: 'Insufficient stock for variant',
      exception: ConflictException,
      publicMessage: 'One or more cart quantities exceed current stock',
    },
    {
      databaseMessage: 'Shipping address does not exist for user',
      exception: BadRequestException,
      publicMessage: 'Shipping address not found',
    },
  ])(
    'maps a checkout failure without exposing database details: $databaseMessage',
    async ({ databaseMessage, exception, publicMessage }) => {
      transaction.mockRejectedValueOnce(triggerError(databaseMessage));

      await expect(service.checkout(userId, { addressId })).rejects.toEqual(
        expect.objectContaining({
          constructor: exception,
          message: publicMessage,
        }),
      );
      expect(orderFindUnique).not.toHaveBeenCalled();
    },
  );

  it('scopes customer order lookup by both order and user IDs', async () => {
    orderFindUnique.mockResolvedValueOnce(null);

    await expect(
      service.findOwnOrder(userId, firstOrderId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(orderFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: firstOrderId, userId } }),
    );
  });

  it('restocks a cancelled order once and rejects a repeated cancellation', async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: firstOrderId, status: OrderStatus.confirmed },
      ])
      .mockResolvedValueOnce([
        { id: firstOrderId, status: OrderStatus.cancelled },
      ]);
    orderItemFindMany.mockResolvedValueOnce([{ variantId, quantity: 2 }]);
    productVariantUpdate.mockResolvedValueOnce({ id: variantId });
    orderUpdate.mockResolvedValueOnce({ id: firstOrderId });
    orderFindUnique.mockResolvedValueOnce(detail());

    await expect(
      service.updateStatus(firstOrderId, OrderStatus.cancelled),
    ).resolves.toEqual(expect.objectContaining({ status: 'cancelled' }));
    await expect(
      service.updateStatus(firstOrderId, OrderStatus.cancelled),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(productVariantUpdate).toHaveBeenCalledOnce();
    expect(productVariantUpdate).toHaveBeenCalledWith({
      where: { id: variantId },
      data: { stockQuantity: { increment: 2 } },
      select: { id: true },
    });
    expect(orderUpdate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
