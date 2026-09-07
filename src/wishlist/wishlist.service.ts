import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatMoney } from '../common/money/money.js';
import {
  decodeIdCursor,
  encodeIdCursor,
} from '../common/pagination/opaque-id-cursor.js';
import { Prisma } from '../generated/prisma/client.js';
import { isPrismaKnownRequestError } from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AddWishlistItemDto,
  MergeWishlistDto,
} from './dto/wishlist-item.dto.js';
import type { ListWishlistQueryDto } from './dto/list-wishlist-query.dto.js';
import {
  WISHLIST_ITEM_SELECT,
  type WishlistItemRecord,
} from './wishlist.select.js';
import type { WishlistItemView, WishlistView } from './wishlist.types.js';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findWishlist(
    userId: string,
    query: ListWishlistQueryDto = { pageSize: 20 },
  ): Promise<WishlistView> {
    const cursorContext = `wishlist:user:${userId}`;
    const cursorId = query.cursor
      ? decodeIdCursor(query.cursor, cursorContext)
      : undefined;
    const [records, itemCount] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: cursorId ? { id: cursorId } : undefined,
        skip: cursorId ? 1 : 0,
        take: query.pageSize + 1,
        select: WISHLIST_ITEM_SELECT,
      }),
      this.prisma.wishlistItem.count({ where: { userId } }),
    ]);
    const hasNextPage = records.length > query.pageSize;
    const pageRecords = records.slice(0, query.pageSize);
    const last = pageRecords.at(-1);
    return this.toView(pageRecords, itemCount, {
      hasNextPage,
      endCursor: last ? encodeIdCursor(last.id, cursorContext) : null,
    });
  }

  addItem(userId: string, input: AddWishlistItemDto): Promise<WishlistView> {
    return this.mutate(userId, async (tx) => {
      await this.assertAvailableReference(tx, input);
      await this.insertIgnoringDuplicate(tx, userId, input);
    });
  }

  removeItem(userId: string, wishlistItemId: string): Promise<WishlistView> {
    return this.mutate(userId, async (tx) => {
      const removed = await tx.wishlistItem.deleteMany({
        where: { id: wishlistItemId, userId },
      });
      if (removed.count !== 1) {
        throw new NotFoundException('Wishlist item not found');
      }
    });
  }

  merge(userId: string, input: MergeWishlistDto): Promise<WishlistView> {
    const uniqueItems = new Map<string, AddWishlistItemDto>();
    for (const item of input.items) {
      uniqueItems.set(`${item.productId}:${item.variantId ?? ''}`, item);
    }
    return this.mutate(userId, async (tx) => {
      for (const item of uniqueItems.values()) {
        await this.assertAvailableReference(tx, item);
      }
      for (const item of uniqueItems.values()) {
        await this.insertIgnoringDuplicate(tx, userId, item);
      }
    });
  }

  private async mutate(
    userId: string,
    mutation: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<WishlistView> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockActiveUser(tx, userId);
        await mutation(tx);
      });
      return await this.findWishlist(userId);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (isPrismaKnownRequestError(error, 'P2034')) {
        throw new ConflictException('Concurrent wishlist update; please retry');
      }
      throw error;
    }
  }

  private async assertAvailableReference(
    tx: Prisma.TransactionClient,
    item: AddWishlistItemDto,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      item.variantId
        ? Prisma.sql`
          SELECT p.id
          FROM products p
          JOIN categories c ON c.id = p.category_id
          JOIN product_variants v
            ON v.product_id = p.id AND v.id = ${item.variantId}::uuid
          WHERE p.id = ${item.productId}::uuid
            AND p.is_active AND p.deleted_at IS NULL
            AND c.deleted_at IS NULL AND v.deleted_at IS NULL
        `
        : Prisma.sql`
          SELECT p.id
          FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE p.id = ${item.productId}::uuid
            AND p.is_active AND p.deleted_at IS NULL
            AND c.deleted_at IS NULL
        `,
    );
    if (!rows[0]) {
      throw new ConflictException('Wishlist product or variant is unavailable');
    }
  }

  private async insertIgnoringDuplicate(
    tx: Prisma.TransactionClient,
    userId: string,
    item: AddWishlistItemDto,
  ): Promise<void> {
    if (item.variantId) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO wishlist_items (user_id, product_id, variant_id)
        VALUES (${userId}::uuid, ${item.productId}::uuid, ${item.variantId}::uuid)
        ON CONFLICT (user_id, product_id, variant_id)
          WHERE variant_id IS NOT NULL
        DO NOTHING
      `);
    } else {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO wishlist_items (user_id, product_id, variant_id)
        VALUES (${userId}::uuid, ${item.productId}::uuid, NULL)
        ON CONFLICT (user_id, product_id)
          WHERE variant_id IS NULL
        DO NOTHING
      `);
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

  private toView(
    records: WishlistItemRecord[],
    itemCount: number,
    pageInfo: WishlistView['pageInfo'],
  ): WishlistView {
    const items = records.map((record): WishlistItemView => {
      const { product, variant, ...item } = record;
      const productAvailable =
        product.isActive &&
        product.deletedAt === null &&
        product.category.deletedAt === null;
      const available = variant
        ? productAvailable &&
          variant.deletedAt === null &&
          variant.stockQuantity > 0
        : productAvailable;
      return {
        ...item,
        available,
        price: formatMoney(variant?.effectivePrice ?? product.basePrice),
        currencyCode: product.currencyCode,
        product: {
          title: product.title,
          slug: product.slug,
          imageUrl:
            variant?.images[0]?.imageUrl ?? product.images[0]?.imageUrl ?? null,
        },
        variant: variant
          ? { sku: variant.sku, stockQuantity: variant.stockQuantity }
          : null,
      };
    });
    return { items, itemCount, pageInfo };
  }
}
