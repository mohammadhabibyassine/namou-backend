import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CartService } from '../src/cart/cart.service.js';
import { OrderStatus, Prisma } from '../src/generated/prisma/client.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProductsAdminService } from '../src/products/products-admin.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { ProductsService } from '../src/products/products.service.js';
import { UsersService } from '../src/users/users.service.js';
import { AttributesService } from '../src/variants/attributes.service.js';
import { VariantsService } from '../src/variants/variants.service.js';
import { WishlistService } from '../src/wishlist/wishlist.service.js';
import type { ApplicationCacheService } from '../src/cache/application-cache.service.js';
import type { OrderJobsService } from '../src/jobs/order-jobs.service.js';
import type { StorageService } from '../src/storage/storage.service.js';

const ROLLBACK = new Error('intentional commerce smoke-test rollback');
const noOpCache = {
  remember: async (
    _namespace: string,
    _key: string,
    _ttl: number,
    loader: () => Promise<unknown>,
  ) => loader(),
  invalidate: async () => undefined,
} as unknown as ApplicationCacheService;
const noOpOrderJobs = {
  enqueueConfirmation: async () => undefined,
} as unknown as OrderJobsService;
const noOpStorage = {
  verifyProductObject: async (_productId: string, objectKey: string) =>
    `https://media.namou.test/${objectKey}`,
} as unknown as StorageService;

describe('Commerce database workflows (e2e)', () => {
  let moduleFixture: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleFixture.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await moduleFixture.close();
  });

  it('runs variants, addresses, cart, wishlist, checkout and cancellation atomically', async () => {
    await expect(
      prisma.$transaction(
        async (tx) => {
          // Let the pg adapter finish its BEGIN callback before the rollback-only
          // facade starts issuing nested service queries on the same client.
          await new Promise<void>((resolve) => setImmediate(resolve));
          const client = transactionFacade(tx);
          const attributes = new AttributesService(client, noOpCache);
          const products = new ProductsAdminService(client, noOpCache);
          const catalog = new ProductsService(
            new ProductsRepository(client),
            noOpCache,
          );
          const variants = new VariantsService(
            client,
            noOpCache,
            noOpStorage,
          );
          const users = new UsersService(client);
          const cart = new CartService(client);
          const wishlist = new WishlistService(client);
          const orders = new OrdersService(client, noOpOrderJobs, noOpCache);
          const suffix = randomUUID();

          const user = await users.create({
            email: `commerce-${suffix}@example.com`,
            passwordHash: 'not-used-in-this-test',
            roleName: 'customer',
          });
          const profile = await users.updateProfile(user.id, {
            firstName: 'Maya',
            phone: '+9611000000',
          });
          expect(profile.firstName).toBe('Maya');

          const address = await users.createAddress(user.id, {
            label: 'Home',
            recipientName: 'Maya Customer',
            addressLine1: '1 Test Street',
            city: 'Beirut',
            postalCode: '1107',
            countryCode: 'LB',
            isDefault: false,
          });
          expect(address.isDefault).toBe(true);

          const category = await tx.category.create({
            data: { name: `Commerce ${suffix}`, slug: `commerce-${suffix}` },
            select: { id: true },
          });
          const color = await attributes.createType({
            name: `Color ${suffix}`,
            slug: `color-${suffix}`,
            sortOrder: 0,
          });
          const red = await attributes.createValue(color.id, {
            value: `Red ${suffix}`,
            sortOrder: 0,
          });
          const blue = await attributes.createValue(color.id, {
            value: `Blue ${suffix}`,
            sortOrder: 1,
          });
          const createdProduct = await products.create({
            categoryId: category.id,
            title: 'Smoke Test Shirt',
            slug: `smoke-shirt-${suffix}`,
            description: null,
            basePrice: '20.00',
            currencyCode: 'USD',
            isActive: true,
            attributes: [{ attributeTypeId: color.id, sortOrder: 0 }],
            variants: [
              {
                sku: `SMOKE-RED-${suffix}`,
                priceOverride: null,
                stockQuantity: 8,
                isDefault: true,
                options: [
                  { attributeTypeId: color.id, attributeValueId: red.id },
                ],
              },
              {
                sku: `SMOKE-BLUE-${suffix}`,
                priceOverride: '22.00',
                stockQuantity: 4,
                isDefault: false,
                options: [
                  { attributeTypeId: color.id, attributeValueId: blue.id },
                ],
              },
            ],
            images: [],
          });
          const initialConfiguration = await variants.findConfiguration(
            createdProduct.id,
          );
          const redVariant = initialConfiguration.variants.find(
            ({ isDefault }) => isDefault,
          );
          const blueVariant = initialConfiguration.variants.find(
            ({ isDefault }) => !isDefault,
          );
          expect(redVariant).toBeDefined();
          expect(blueVariant).toBeDefined();
          if (!redVariant || !blueVariant) throw new Error('Missing variants');

          const replaced = await variants.replaceConfiguration(
            createdProduct.id,
            {
              attributes: [{ attributeTypeId: color.id, sortOrder: 0 }],
              variants: [
                {
                  id: redVariant.id,
                  sku: blueVariant.sku,
                  priceOverride: null,
                  stockQuantity: 8,
                  isDefault: true,
                  options: [
                    { attributeTypeId: color.id, attributeValueId: red.id },
                  ],
                },
                {
                  id: blueVariant.id,
                  sku: redVariant.sku,
                  priceOverride: '22.00',
                  stockQuantity: 4,
                  isDefault: false,
                  options: [
                    { attributeTypeId: color.id, attributeValueId: blue.id },
                  ],
                },
              ],
            },
          );
          expect(replaced.variants).toHaveLength(2);

          const images = await variants.replaceImages(createdProduct.id, {
            images: [
              {
                objectKey: `products/${createdProduct.id}/${randomUUID()}.webp`,
                altText: 'Smoke shirt',
                sortOrder: 0,
                variantId: redVariant.id,
              },
            ],
          });
          expect(images[0]?.variantId).toBe(redVariant.id);

          const facets = await catalog.findCatalogFacets({
            categoryId: category.id,
            currencyCode: 'USD',
          });
          expect(facets.attributes).toEqual([
            expect.objectContaining({
              id: color.id,
              values: expect.arrayContaining([
                expect.objectContaining({ id: red.id }),
                expect.objectContaining({ id: blue.id }),
              ]),
            }),
          ]);
          expect(facets.priceRanges).toEqual([
            {
              currencyCode: 'USD',
              minimumPrice: '20.00',
              maximumPrice: '22.00',
            },
          ]);

          await cart.addItem(user.id, {
            variantId: redVariant.id,
            quantity: 2,
          });
          const mergedCart = await cart.merge(user.id, {
            items: [{ variantId: blueVariant.id, quantity: 1 }],
          });
          expect(mergedCart.quantityTotal).toBe(3);
          const retriedMerge = await cart.merge(user.id, {
            items: [{ variantId: blueVariant.id, quantity: 1 }],
          });
          expect(retriedMerge.quantityTotal).toBe(3);

          const firstWishlist = await wishlist.addItem(user.id, {
            productId: createdProduct.id,
          });
          const duplicateWishlist = await wishlist.addItem(user.id, {
            productId: createdProduct.id,
          });
          expect(firstWishlist.itemCount).toBe(1);
          expect(firstWishlist.items[0]?.product.imageUrl).toBeNull();
          expect(duplicateWishlist.itemCount).toBe(1);

          const stockBeforeFailedCheckouts = await tx.productVariant.findMany({
            where: { id: { in: [redVariant.id, blueVariant.id] } },
            orderBy: { id: 'asc' },
            select: { id: true, stockQuantity: true },
          });
          await expect(
            orders.checkout(user.id, { addressId: randomUUID() }),
          ).rejects.toBeInstanceOf(BadRequestException);
          expect(await tx.order.count({ where: { userId: user.id } })).toBe(0);
          expect(await cart.findCart(user.id)).toMatchObject({
            itemCount: 2,
            quantityTotal: 3,
          });

          await tx.cartItem.update({
            where: {
              userId_variantId: {
                userId: user.id,
                variantId: blueVariant.id,
              },
            },
            data: { quantity: 5 },
          });
          await expect(
            orders.checkout(user.id, { addressId: address.id }),
          ).rejects.toBeInstanceOf(ConflictException);
          expect(await tx.order.count({ where: { userId: user.id } })).toBe(0);
          expect(
            await tx.productVariant.findMany({
              where: { id: { in: [redVariant.id, blueVariant.id] } },
              orderBy: { id: 'asc' },
              select: { id: true, stockQuantity: true },
            }),
          ).toEqual(stockBeforeFailedCheckouts);
          await tx.cartItem.update({
            where: {
              userId_variantId: {
                userId: user.id,
                variantId: blueVariant.id,
              },
            },
            data: { quantity: 1 },
          });

          const order = await orders.checkout(user.id, {
            addressId: address.id,
          });
          expect(order.items).toHaveLength(2);
          expect(order.total).toBe('62.00');
          expect((await cart.findCart(user.id)).itemCount).toBe(0);

          await orders.updateStatus(order.id, OrderStatus.confirmed);
          const cancelled = await orders.updateStatus(
            order.id,
            OrderStatus.cancelled,
          );
          expect(cancelled.statusHistory).toHaveLength(3);
          expect(
            cancelled.statusHistory.map(({ toStatus }) => toStatus),
          ).toEqual(
            expect.arrayContaining([
              OrderStatus.pending,
              OrderStatus.confirmed,
              OrderStatus.cancelled,
            ]),
          );
          const restored = await tx.productVariant.findMany({
            where: { id: { in: [redVariant.id, blueVariant.id] } },
            orderBy: { id: 'asc' },
            select: { stockQuantity: true },
          });
          expect(
            restored.map(({ stockQuantity }) => stockQuantity).sort(),
          ).toEqual([4, 8]);

          throw ROLLBACK;
        },
        { timeout: 30_000 },
      ),
    ).rejects.toBe(ROLLBACK);
  });
});

function transactionFacade(tx: Prisma.TransactionClient): PrismaService {
  let savepointCounter = 0;
  let facade: PrismaService;
  facade = new Proxy(tx as unknown as PrismaService, {
    get(target, property) {
      if (property === '$transaction') {
        return async (
          callback: (client: Prisma.TransactionClient) => unknown,
        ) => {
          const savepoint = `commerce_service_${++savepointCounter}`;
          await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
          try {
            const result = await callback(
              facade as unknown as Prisma.TransactionClient,
            );
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
            return result;
          } catch (error: unknown) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
            throw error;
          }
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return facade;
}
