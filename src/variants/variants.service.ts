import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationCacheService } from '../cache/application-cache.service.js';
import { CacheNamespace } from '../cache/cache.constants.js';
import { formatMoney } from '../common/money/money.js';
import { normalizeSku } from '../common/normalizers/sku.normalizer.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { ReplaceProductImagesDto } from './dto/replace-product-images.dto.js';
import type { ReplaceVariantConfigurationDto } from './dto/replace-variant-configuration.dto.js';
import type { UpdateVariantDto } from './dto/update-variant.dto.js';
import { prepareVariantConfiguration } from './variant-configuration.js';
import {
  ADMIN_IMAGE_SELECT,
  ADMIN_VARIANT_SELECT,
  type AdminImageRecord,
  type AdminVariantRecord,
} from './variants.select.js';
import type {
  AdminVariantView,
  ProductImageAdminView,
  VariantConfigurationView,
} from './variants.types.js';

const WRITE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

@Injectable()
export class VariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ApplicationCacheService,
    private readonly storage: StorageService,
  ) {}

  async findConfiguration(
    productId: string,
  ): Promise<VariantConfigurationView> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, deletedAt: null },
      select: {
        attributeTypes: {
          orderBy: [{ sortOrder: 'asc' }, { attributeTypeId: 'asc' }],
          select: { attributeTypeId: true, sortOrder: true },
        },
        variants: {
          where: { deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: ADMIN_VARIANT_SELECT,
        },
      },
    });
    if (!product) {
      throw this.productNotFound();
    }

    return {
      attributes: product.attributeTypes,
      variants: product.variants.map((variant) => this.toVariantView(variant)),
    };
  }

  async replaceConfiguration(
    productId: string,
    input: ReplaceVariantConfigurationDto,
  ): Promise<VariantConfigurationView> {
    const configuration = prepareVariantConfiguration(
      input.attributes,
      input.variants,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        const product = await this.lockProduct(tx, productId);
        await this.assertAttributeReferences(
          tx,
          configuration.attributes.map(
            ({ attributeTypeId }) => attributeTypeId,
          ),
          configuration.offeredAttributeValues,
        );

        const existing = await tx.productVariant.findMany({
          where: { productId, deletedAt: null },
          select: { id: true },
        });
        const existingIds = new Set(existing.map(({ id }) => id));
        const submittedIds = new Set(
          configuration.variants.flatMap((variant) =>
            variant.id ? [variant.id] : [],
          ),
        );
        if ([...submittedIds].some((id) => !existingIds.has(id))) {
          throw new BadRequestException(
            'Every submitted variant id must be an active variant of this product',
          );
        }

        const omittedIds = [...existingIds].filter(
          (id) => !submittedIds.has(id),
        );
        if (omittedIds.length > 0) {
          await tx.productImage.updateMany({
            where: { productId, variantId: { in: omittedIds } },
            data: { variantId: null },
          });
          await tx.productVariant.updateMany({
            where: { productId, id: { in: omittedIds }, deletedAt: null },
            data: { deletedAt: new Date(), isDefault: false },
          });
        }

        // Free the unique default and SKU keys before applying the complete new
        // matrix. This also supports swapping two existing SKUs in one request.
        await tx.productVariant.updateMany({
          where: { productId, id: { in: [...submittedIds] }, deletedAt: null },
          data: { isDefault: false },
        });
        for (const variantId of submittedIds) {
          await tx.productVariant.update({
            where: { id: variantId, productId, deletedAt: null },
            data: { sku: `__tmp__${randomUUID()}` },
            select: { id: true },
          });
        }

        await tx.productAttributeType.deleteMany({ where: { productId } });
        if (configuration.attributes.length > 0) {
          await tx.productAttributeType.createMany({
            data: configuration.attributes.map((attribute) => ({
              productId,
              ...attribute,
            })),
          });
        }
        if (configuration.offeredAttributeValues.length > 0) {
          await tx.productAttributeValue.createMany({
            data: configuration.offeredAttributeValues.map((option) => ({
              productId,
              ...option,
            })),
          });
        }

        const variantIdByPosition = new Map<number, string>();
        for (const [position, variant] of configuration.variants.entries()) {
          if (variant.id) {
            await tx.productVariant.update({
              where: { id: variant.id, productId, deletedAt: null },
              data: {
                sku: variant.sku,
                priceOverride: variant.priceOverride,
                stockQuantity: variant.stockQuantity,
                isDefault: variant.isDefault,
              },
              select: { id: true },
            });
            variantIdByPosition.set(position, variant.id);
          } else {
            const created = await tx.productVariant.create({
              data: {
                productId,
                sku: variant.sku,
                priceOverride: variant.priceOverride,
                effectivePrice:
                  variant.priceOverride ?? formatMoney(product.basePrice),
                stockQuantity: variant.stockQuantity,
                isDefault: variant.isDefault,
              },
              select: { id: true },
            });
            variantIdByPosition.set(position, created.id);
          }
        }

        const optionRows = configuration.variants.flatMap(
          (variant, position) => {
            const variantId = variantIdByPosition.get(position);
            if (!variantId) {
              throw new Error('Variant write result could not be resolved');
            }
            return variant.options.map((option) => ({
              productId,
              variantId,
              ...option,
            }));
          },
        );
        if (optionRows.length > 0) {
          await tx.variantAttributeValue.createMany({ data: optionRows });
        }
      }, WRITE_TRANSACTION_OPTIONS);

      await this.invalidateCatalog();
      return await this.findConfiguration(productId);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }

  async updateVariant(
    productId: string,
    variantId: string,
    input: UpdateVariantDto,
  ): Promise<AdminVariantView> {
    if (
      input.sku === undefined &&
      input.priceOverride === undefined &&
      input.stockQuantity === undefined
    ) {
      throw new BadRequestException('At least one variant field is required');
    }

    try {
      const variant = await this.prisma.productVariant.update({
        where: {
          id: variantId,
          productId,
          deletedAt: null,
          product: { deletedAt: null },
        },
        data: {
          sku: input.sku === undefined ? undefined : normalizeSku(input.sku),
          priceOverride:
            input.priceOverride === undefined ? undefined : input.priceOverride,
          stockQuantity: input.stockQuantity,
        },
        select: ADMIN_VARIANT_SELECT,
      });
      await this.invalidateCatalog();
      return this.toVariantView(variant);
    } catch (error: unknown) {
      this.rethrowWriteError(error, 'Variant not found');
    }
  }

  async softDeleteVariant(productId: string, variantId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const product = await this.lockProduct(tx, productId);
        const variants = await tx.productVariant.findMany({
          where: { productId, deletedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, isDefault: true },
        });
        const target = variants.find(({ id }) => id === variantId);
        if (!target) {
          throw new NotFoundException('Variant not found');
        }
        if (product.isActive && variants.length === 1) {
          throw new ConflictException(
            'Deactivate the product before deleting its last active variant',
          );
        }

        await tx.productImage.updateMany({
          where: { productId, variantId },
          data: { variantId: null },
        });
        await tx.productVariant.update({
          where: { id: variantId, productId, deletedAt: null },
          data: { deletedAt: new Date(), isDefault: false },
          select: { id: true },
        });
        if (target.isDefault && variants.length > 1) {
          const replacement = variants.find(({ id }) => id !== variantId);
          if (replacement) {
            await tx.productVariant.update({
              where: { id: replacement.id },
              data: { isDefault: true },
              select: { id: true },
            });
          }
        }
      }, WRITE_TRANSACTION_OPTIONS);
      await this.invalidateCatalog();
    } catch (error: unknown) {
      this.rethrowWriteError(error, 'Variant not found');
    }
  }

  async replaceImages(
    productId: string,
    input: ReplaceProductImagesDto,
  ): Promise<ProductImageAdminView[]> {
    if (
      input.images.some(
        (image) => Boolean(image.id) === Boolean(image.objectKey),
      )
    ) {
      throw new BadRequestException(
        'Every image must provide either an existing id or a new objectKey',
      );
    }
    const ids = input.images.flatMap((image) => (image.id ? [image.id] : []));
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Existing image IDs must be unique');
    }
    if (
      new Set(input.images.map(({ sortOrder }) => sortOrder)).size !==
      input.images.length
    ) {
      throw new BadRequestException('Product image sort orders must be unique');
    }
    const objectKeys = input.images.flatMap((image) =>
      image.objectKey ? [image.objectKey] : [],
    );
    if (new Set(objectKeys).size !== objectKeys.length) {
      throw new BadRequestException(
        'Uploaded image object keys must be unique',
      );
    }

    const uploadedImageUrls = new Map(
      await Promise.all(
        objectKeys.map(
          async (objectKey) =>
            [
              objectKey,
              await this.storage.verifyProductObject(productId, objectKey),
            ] as const,
        ),
      ),
    );

    try {
      const images = await this.prisma.$transaction(async (tx) => {
        await this.lockProduct(tx, productId);
        const existing = await tx.productImage.findMany({
          where: { productId },
          select: { id: true, imageUrl: true },
        });
        const existingImages = new Map(
          existing.map((image) => [image.id, image]),
        );
        const existingIds = new Set(existingImages.keys());
        if (ids.some((id) => !existingIds.has(id))) {
          throw new BadRequestException(
            'Every submitted image id must belong to this product',
          );
        }

        const variantIds = [
          ...new Set(
            input.images.flatMap(({ variantId }) =>
              variantId ? [variantId] : [],
            ),
          ),
        ];
        if (variantIds.length > 0) {
          const validVariants = await tx.productVariant.count({
            where: { productId, id: { in: variantIds }, deletedAt: null },
          });
          if (validVariants !== variantIds.length) {
            throw new BadRequestException(
              'Every image variantId must be an active variant of this product',
            );
          }
        }

        await tx.productImage.deleteMany({
          where: { productId, id: { notIn: ids } },
        });
        for (const image of input.images) {
          const imageUrl = image.id
            ? existingImages.get(image.id)?.imageUrl
            : uploadedImageUrls.get(image.objectKey ?? '');
          if (!imageUrl) {
            throw new BadRequestException(
              'Product image could not be resolved',
            );
          }
          const data = {
            imageUrl,
            altText: image.altText?.trim() ?? null,
            sortOrder: image.sortOrder,
            variantId: image.variantId ?? null,
          };
          if (image.id) {
            await tx.productImage.update({
              where: { id: image.id, productId },
              data,
              select: { id: true },
            });
          } else {
            await tx.productImage.create({
              data: { productId, ...data },
              select: { id: true },
            });
          }
        }

        const images = await tx.productImage.findMany({
          where: { productId },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: ADMIN_IMAGE_SELECT,
        });
        return images.map((image) => this.toImageView(image));
      }, WRITE_TRANSACTION_OPTIONS);
      await this.invalidateCatalog();
      return images;
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }

  async findImages(productId: string): Promise<ProductImageAdminView[]> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, deletedAt: null },
      select: {
        images: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: ADMIN_IMAGE_SELECT,
        },
      },
    });
    if (!product) throw this.productNotFound();
    return product.images.map((image) => this.toImageView(image));
  }

  private async lockProduct(tx: Prisma.TransactionClient, productId: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; basePrice: Prisma.Decimal; isActive: boolean }>
    >(Prisma.sql`
      SELECT id, base_price AS "basePrice", is_active AS "isActive"
      FROM products
      WHERE id = ${productId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw this.productNotFound();
    }
    return rows[0];
  }

  private async assertAttributeReferences(
    tx: Prisma.TransactionClient,
    attributeTypeIds: string[],
    options: Array<{ attributeTypeId: string; attributeValueId: string }>,
  ): Promise<void> {
    if (attributeTypeIds.length === 0) return;
    const types = await tx.attributeType.findMany({
      where: { id: { in: attributeTypeIds } },
      select: { id: true },
    });
    const values = await tx.attributeValue.findMany({
      where: {
        id: { in: options.map(({ attributeValueId }) => attributeValueId) },
      },
      select: { id: true, attributeTypeId: true },
    });
    const valueTypes = new Map(
      values.map(({ id, attributeTypeId }) => [id, attributeTypeId]),
    );
    if (
      types.length !== attributeTypeIds.length ||
      options.some(
        ({ attributeTypeId, attributeValueId }) =>
          valueTypes.get(attributeValueId) !== attributeTypeId,
      )
    ) {
      throw new BadRequestException(
        'Attribute type or value reference is invalid',
      );
    }
  }

  private toVariantView(variant: AdminVariantRecord): AdminVariantView {
    const { attributeValues, ...record } = variant;
    return {
      ...record,
      priceOverride: variant.priceOverride
        ? formatMoney(variant.priceOverride)
        : null,
      effectivePrice: formatMoney(variant.effectivePrice),
      options: attributeValues,
    };
  }

  private toImageView(image: AdminImageRecord): ProductImageAdminView {
    return image;
  }

  private rethrowWriteError(
    error: unknown,
    notFoundMessage = 'Product not found',
  ): never {
    if (error instanceof HttpException) throw error;
    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw new NotFoundException(notFoundMessage);
    }
    if (isPrismaKnownRequestError(error, 'P2002')) {
      throw new ConflictException(
        'Variant SKU, combination, or image order is already in use',
      );
    }
    if (isPrismaKnownRequestError(error, 'P2003')) {
      throw new BadRequestException(
        'Attribute, variant, or image reference is invalid',
      );
    }
    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException('Concurrent product update; please retry');
    }
    const databaseError = getPrismaDatabaseError(error);
    if (databaseError?.code === '23505') {
      throw new ConflictException(
        'Variant SKU, combination, or image order is already in use',
      );
    }
    if (databaseError?.code === '23503') {
      throw new BadRequestException(
        'Attribute, variant, or image reference is invalid',
      );
    }
    if (databaseError?.code === 'P0001') {
      throw new BadRequestException('Invalid product variant configuration');
    }
    throw error;
  }

  private productNotFound(): NotFoundException {
    return new NotFoundException('Product not found');
  }

  private invalidateCatalog(): Promise<void> {
    return this.cache.invalidate(CacheNamespace.ProductCatalog);
  }
}
