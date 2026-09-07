import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  decodeIdCursor,
  encodeIdCursor,
} from '../common/pagination/opaque-id-cursor.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import { formatMoney } from '../common/money/money.js';
import { Prisma } from '../generated/prisma/client.js';
import { OrderStatus } from '../generated/prisma/enums.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrderJobsService } from '../jobs/order-jobs.service.js';
import { OrderNotificationKind } from '../jobs/order-jobs.constants.js';
import { ApplicationCacheService } from '../cache/application-cache.service.js';
import { CacheNamespace } from '../cache/cache.constants.js';
import type { CheckoutDto } from './dto/checkout.dto.js';
import type { ListOrdersQueryDto } from './dto/list-orders-query.dto.js';
import {
  ORDER_DETAIL_SELECT,
  ORDER_SUMMARY_SELECT,
  type OrderDetailRecord,
  type OrderSummaryRecord,
} from './orders.select.js';
import type { OrderDetailView, OrderSummaryView } from './orders.types.js';

const WRITE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: [OrderStatus.confirmed, OrderStatus.cancelled],
  confirmed: [OrderStatus.shipped, OrderStatus.cancelled],
  shipped: [OrderStatus.delivered],
  delivered: [],
  cancelled: [],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderJobs: OrderJobsService,
    private readonly cache: ApplicationCacheService,
  ) {}

  async checkout(userId: string, input: CheckoutDto): Promise<OrderDetailView> {
    try {
      const orderId = await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        const cartItems = await tx.$queryRaw<
          Array<{ id: string; variantId: string; quantity: number }>
        >(Prisma.sql`
          SELECT id, variant_id AS "variantId", quantity
          FROM cart_items
          WHERE user_id = ${userId}::uuid
          ORDER BY variant_id
          FOR UPDATE
        `);
        if (cartItems.length === 0) {
          throw new BadRequestException('Cart is empty');
        }

        const items = cartItems.map(({ variantId, quantity }) => ({
          variant_id: variantId,
          quantity,
        }));
        const result = await tx.$queryRaw<
          Array<{ orderId: string }>
        >(Prisma.sql`
          SELECT place_order(
            ${userId}::uuid,
            ${input.addressId}::uuid,
            ${JSON.stringify(items)}::jsonb,
            0::numeric,
            0::numeric,
            0::numeric,
            ${input.notes?.trim() ?? null}
          ) AS "orderId"
        `);
        const createdOrderId = result[0]?.orderId;
        if (!createdOrderId) {
          throw new Error('place_order did not return an order id');
        }

        await tx.cartItem.deleteMany({
          where: { id: { in: cartItems.map(({ id }) => id) }, userId },
        });
        await tx.orderNotificationOutbox.create({
          data: {
            orderId: createdOrderId,
            kind: OrderNotificationKind.Confirmation,
          },
          select: { id: true },
        });
        return createdOrderId;
      }, WRITE_TRANSACTION_OPTIONS);
      const order = await this.findOwnOrder(userId, orderId);
      await this.cache.invalidate(CacheNamespace.ProductCatalog);
      await this.orderJobs.enqueueConfirmation(order.id);
      return order;
    } catch (error: unknown) {
      this.rethrowCheckoutError(error);
    }
  }

  findOwnPage(
    userId: string,
    query: ListOrdersQueryDto,
  ): Promise<CursorPage<OrderSummaryView>> {
    return this.findPage({ userId }, query);
  }

  findAdminPage(
    query: ListOrdersQueryDto,
  ): Promise<CursorPage<OrderSummaryView>> {
    return this.findPage({}, query);
  }

  async findOwnOrder(
    userId: string,
    orderId: string,
  ): Promise<OrderDetailView> {
    return this.findOrder({ id: orderId, userId });
  }

  async findAdminOrder(orderId: string): Promise<OrderDetailView> {
    return this.findOrder({ id: orderId });
  }

  async updateStatus(
    orderId: string,
    nextStatus: OrderStatus,
  ): Promise<OrderDetailView> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: OrderStatus }>
        >(
          Prisma.sql`
            SELECT id, status
            FROM orders
            WHERE id = ${orderId}::uuid
            FOR UPDATE
          `,
        );
        const current = rows[0];
        if (!current) throw new NotFoundException('Order not found');
        if (!ALLOWED_TRANSITIONS[current.status].includes(nextStatus)) {
          throw new ConflictException(
            `Order cannot transition from ${current.status} to ${nextStatus}`,
          );
        }

        if (nextStatus === OrderStatus.cancelled) {
          const items = await tx.orderItem.findMany({
            where: { orderId },
            orderBy: { variantId: 'asc' },
            select: { variantId: true, quantity: true },
          });
          for (const item of items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stockQuantity: { increment: item.quantity } },
              select: { id: true },
            });
          }
        }
        await tx.order.update({
          where: { id: orderId },
          data: { status: nextStatus },
          select: { id: true },
        });
      }, WRITE_TRANSACTION_OPTIONS);
      if (nextStatus === OrderStatus.cancelled) {
        await this.cache.invalidate(CacheNamespace.ProductCatalog);
      }
      return await this.findAdminOrder(orderId);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (isPrismaKnownRequestError(error, 'P2034')) {
        throw new ConflictException('Concurrent order update; please retry');
      }
      throw error;
    }
  }

  private async findPage(
    scope: { userId?: string },
    query: ListOrdersQueryDto,
  ): Promise<CursorPage<OrderSummaryView>> {
    const cursorContext = this.orderCursorContext(scope, query.status);
    const cursorId = query.cursor
      ? decodeIdCursor(query.cursor, cursorContext)
      : undefined;
    const records = await this.prisma.order.findMany({
      where: {
        ...scope,
        status: query.status,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: cursorId ? { id: cursorId } : undefined,
      skip: cursorId ? 1 : 0,
      take: query.pageSize + 1,
      select: ORDER_SUMMARY_SELECT,
    });
    const hasNextPage = records.length > query.pageSize;
    const pageRecords = records.slice(0, query.pageSize);
    const last = pageRecords.at(-1);
    return {
      items: pageRecords.map((record) => this.toSummaryView(record)),
      pageInfo: {
        hasNextPage,
        endCursor: last ? encodeIdCursor(last.id, cursorContext) : null,
      },
    };
  }

  private orderCursorContext(
    scope: { userId?: string },
    status?: OrderStatus,
  ): string {
    return `orders:${scope.userId ? `user:${scope.userId}` : 'admin'}:status:${status ?? '*'}`;
  }

  private async findOrder(where: {
    id: string;
    userId?: string;
  }): Promise<OrderDetailView> {
    const order = await this.prisma.order.findUnique({
      where,
      select: ORDER_DETAIL_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found');
    return this.toDetailView(order);
  }

  private async lockActiveUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM users
      WHERE id = ${userId}::uuid AND is_active AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!rows[0]) throw new NotFoundException('User not found');
  }

  private toSummaryView(order: OrderSummaryRecord): OrderSummaryView {
    return { ...order, total: this.formatGeneratedMoney(order.total) };
  }

  private toDetailView(order: OrderDetailRecord): OrderDetailView {
    return {
      id: order.id,
      userId: order.userId,
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: formatMoney(order.subtotal),
      discountAmount: formatMoney(order.discountAmount),
      shippingCost: formatMoney(order.shippingCost),
      taxAmount: formatMoney(order.taxAmount),
      total: this.formatGeneratedMoney(order.total),
      currencyCode: order.currencyCode,
      shippingAddress: {
        recipientName: order.shippingRecipientName,
        addressLine1: order.shippingAddressLine1,
        addressLine2: order.shippingAddressLine2,
        city: order.shippingCity,
        state: order.shippingState,
        postalCode: order.shippingPostalCode,
        countryCode: order.shippingCountryCode,
        phone: order.shippingPhone,
      },
      notes: order.notes,
      items: order.items.map((item) => ({
        ...item,
        unitPrice: formatMoney(item.unitPrice),
        lineTotal: this.formatGeneratedMoney(item.lineTotal),
      })),
      statusHistory: order.statusHistory,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private formatGeneratedMoney(value: Prisma.Decimal | null): string {
    if (value === null) {
      throw new Error('A generated monetary value was unexpectedly null');
    }
    return formatMoney(value);
  }

  private rethrowCheckoutError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException('Concurrent checkout; please retry');
    }
    const databaseError = getPrismaDatabaseError(error);
    if (databaseError?.code === 'P0001') {
      if (databaseError.message.includes('unavailable')) {
        throw new ConflictException('One or more cart items are unavailable');
      }
      if (databaseError.message.includes('Insufficient stock')) {
        throw new ConflictException(
          'One or more cart quantities exceed current stock',
        );
      }
      if (databaseError.message.includes('multiple currencies')) {
        throw new ConflictException(
          'One order cannot contain products in multiple currencies',
        );
      }
      if (databaseError.message.includes('Shipping address')) {
        throw new BadRequestException('Shipping address not found');
      }
      throw new BadRequestException('Checkout request is invalid');
    }
    throw error;
  }
}
