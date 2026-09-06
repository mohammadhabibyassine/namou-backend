import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatMoney } from '../common/money/money.js';
import { Prisma } from '../generated/prisma/client.js';
import { isPrismaKnownRequestError } from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CART_ITEM_SELECT, type CartItemRecord } from './cart.select.js';
import {
  MAX_CART_ITEM_QUANTITY,
  type AddCartItemDto,
  type MergeCartDto,
  type SetCartItemQuantityDto,
} from './dto/cart-item.dto.js';
import type { CartItemView, CartView } from './cart.types.js';

interface AvailableVariantRow {
  id: string;
  stockQuantity: number;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async findCart(userId: string): Promise<CartView> {
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: CART_ITEM_SELECT,
    });
    return this.toCartView(items);
  }

  addItem(userId: string, input: AddCartItemDto): Promise<CartView> {
    return this.mutate(userId, async (tx) => {
      const variant = await this.lockAvailableVariant(tx, input.variantId);
      const current = await tx.cartItem.findUnique({
        where: { userId_variantId: { userId, variantId: input.variantId } },
        select: { id: true, quantity: true },
      });
      const quantity = (current?.quantity ?? 0) + input.quantity;
      this.assertQuantityAvailable(quantity, variant.stockQuantity);
      if (current) {
        await tx.cartItem.update({
          where: { id: current.id },
          data: { quantity },
          select: { id: true },
        });
      } else {
        await tx.cartItem.create({
          data: { userId, variantId: input.variantId, quantity },
          select: { id: true },
        });
      }
    });
  }

  setQuantity(
    userId: string,
    variantId: string,
    input: SetCartItemQuantityDto,
  ): Promise<CartView> {
    return this.mutate(userId, async (tx) => {
      const variant = await this.lockAvailableVariant(tx, variantId);
      this.assertQuantityAvailable(input.quantity, variant.stockQuantity);
      const updated = await tx.cartItem.updateMany({
        where: { userId, variantId },
        data: { quantity: input.quantity },
      });
      if (updated.count !== 1)
        throw new NotFoundException('Cart item not found');
    });
  }

  removeItem(userId: string, variantId: string): Promise<CartView> {
    return this.mutate(userId, async (tx) => {
      const removed = await tx.cartItem.deleteMany({
        where: { userId, variantId },
      });
      if (removed.count !== 1)
        throw new NotFoundException('Cart item not found');
    });
  }

  merge(userId: string, input: MergeCartDto): Promise<CartView> {
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      const quantity = (quantities.get(item.variantId) ?? 0) + item.quantity;
      if (quantity > MAX_CART_ITEM_QUANTITY) {
        throw new BadRequestException(
          `Merged quantity cannot exceed ${MAX_CART_ITEM_QUANTITY}`,
        );
      }
      quantities.set(item.variantId, quantity);
    }

    return this.mutate(userId, async (tx) => {
      const variants = await this.lockAvailableVariants(tx, [
        ...quantities.keys(),
      ]);
      const variantsById = new Map(
        variants.map((variant) => [variant.id, variant]),
      );
      if (variants.length !== quantities.size) {
        throw new ConflictException(
          'One or more cart variants are unavailable',
        );
      }
      const existing = await tx.cartItem.findMany({
        where: { userId, variantId: { in: [...quantities.keys()] } },
        select: { id: true, variantId: true, quantity: true },
      });
      const existingByVariant = new Map(
        existing.map((item) => [item.variantId, item]),
      );
      for (const [variantId, guestQuantity] of quantities) {
        const current = existingByVariant.get(variantId);
        // The server and guest quantities describe two copies of the same
        // desired cart state. MAX is deterministic and makes a login merge
        // safe to retry after an uncertain network response.
        const quantity = Math.max(current?.quantity ?? 0, guestQuantity);
        this.assertQuantityAvailable(
          quantity,
          variantsById.get(variantId)?.stockQuantity ?? 0,
        );
        if (current) {
          await tx.cartItem.update({
            where: { id: current.id },
            data: { quantity },
            select: { id: true },
          });
        } else {
          await tx.cartItem.create({
            data: { userId, variantId, quantity },
            select: { id: true },
          });
        }
      }
    });
  }

  private async mutate(
    userId: string,
    mutation: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<CartView> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        await mutation(tx);
      });
      return await this.findCart(userId);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (isPrismaKnownRequestError(error, 'P2034')) {
        throw new ConflictException('Concurrent cart update; please retry');
      }
      throw error;
    }
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

  private async lockAvailableVariant(
    tx: Prisma.TransactionClient,
    variantId: string,
  ): Promise<AvailableVariantRow> {
    const rows = await this.lockAvailableVariants(tx, [variantId]);
    if (!rows[0]) throw new ConflictException('Variant is unavailable');
    return rows[0];
  }

  private lockAvailableVariants(
    tx: Prisma.TransactionClient,
    variantIds: string[],
  ): Promise<AvailableVariantRow[]> {
    return tx.$queryRaw<AvailableVariantRow[]>(Prisma.sql`
      SELECT v.id, v.stock_quantity AS "stockQuantity"
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE v.id = ANY(ARRAY[${Prisma.join(variantIds)}]::uuid[])
        AND v.deleted_at IS NULL
        AND p.is_active AND p.deleted_at IS NULL
        AND c.deleted_at IS NULL
      ORDER BY v.id
      FOR SHARE OF v
    `);
  }

  private assertQuantityAvailable(
    quantity: number,
    stockQuantity: number,
  ): void {
    if (quantity > MAX_CART_ITEM_QUANTITY) {
      throw new BadRequestException(
        `Cart item quantity cannot exceed ${MAX_CART_ITEM_QUANTITY}`,
      );
    }
    if (quantity > stockQuantity) {
      throw new ConflictException('Requested quantity exceeds current stock');
    }
  }

  private toCartView(records: CartItemRecord[]): CartView {
    const items = records.map((record): CartItemView => {
      const { variant, ...item } = record;
      const product = variant.product;
      const available =
        variant.deletedAt === null &&
        product.deletedAt === null &&
        product.category.deletedAt === null &&
        product.isActive &&
        variant.stockQuantity > 0;
      return {
        ...item,
        available,
        availableQuantity: available ? variant.stockQuantity : 0,
        unitPrice: formatMoney(variant.effectivePrice),
        currencyCode: product.currencyCode,
        product: {
          id: product.id,
          title: product.title,
          slug: product.slug,
          imageUrl:
            variant.images[0]?.imageUrl ?? product.images[0]?.imageUrl ?? null,
        },
        variant: {
          sku: variant.sku,
          options: variant.attributeValues.map(({ productAttributeValue }) => ({
            attributeType:
              productAttributeValue.attributeValue.attributeType.name,
            value: productAttributeValue.attributeValue.value,
          })),
        },
      };
    });
    return {
      items,
      itemCount: items.length,
      quantityTotal: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }
}
