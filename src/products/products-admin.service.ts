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
import { normalizeSlug } from '../common/normalizers/slug.normalizer.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  getPrismaDatabaseError,
  isPrismaKnownRequestError,
} from '../prisma/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateProductDto,
  CreateProductVariantDto,
  ProductVariantOptionDto,
} from './dto/create-product.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import {
  PRODUCT_ADMIN_SELECT,
  type ProductAdminRecord,
} from './products.select.js';
import type {
  ProductAdminView,
  ProductCreatedResult,
} from './products.types.js';
import {
  prepareVariantConfiguration,
  type OfferedAttributeValue,
} from '../variants/variant-configuration.js';

const PRODUCT_TRIGGER_ERROR_CODE = 'P0001';
const PRODUCT_INVARIANT_ERRORS = [
  'must have at least one active variant',
  'must have exactly one active default variant',
  'must have one value for every configured attribute type',
  'An active variant cannot belong to a deleted product',
] as const;
const DATABASE_UNIQUE_VIOLATION = '23505';
const DATABASE_FOREIGN_KEY_VIOLATION = '23503';
const WRITE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

interface PreparedVariant extends Omit<
  CreateProductVariantDto,
  'sku' | 'options'
> {
  sku: string;
  options: ProductVariantOptionDto[];
}

interface PreparedProduct {
  categoryId: string;
  title: string;
  slug: string;
  description: string | null;
  basePrice: string;
  currencyCode: string;
  isActive: boolean;
  attributes: CreateProductDto['attributes'];
  variants: PreparedVariant[];
  offeredAttributeValues: OfferedAttributeValue[];
}

@Injectable()
export class ProductsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ApplicationCacheService,
  ) {}

  async findById(productId: string): Promise<ProductAdminView> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, deletedAt: null },
      select: PRODUCT_ADMIN_SELECT,
    });
    if (!product) {
      throw this.productNotFound();
    }

    return this.toAdminView(product);
  }

  async create(input: CreateProductDto): Promise<ProductCreatedResult> {
    const product = this.prepareAndValidate(input);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => this.createInTransaction(tx, product),
        WRITE_TRANSACTION_OPTIONS,
      );
      await this.invalidateCatalog();
      return created;
    } catch (error: unknown) {
      this.rethrowCreateError(error);
    }
  }

  async update(
    productId: string,
    input: UpdateProductDto,
  ): Promise<ProductAdminView> {
    if (!this.hasMetadataUpdates(input)) {
      throw new BadRequestException('At least one product field is required');
    }

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (input.categoryId !== undefined) {
          await this.lockActiveCategory(tx, input.categoryId);
        }

        return tx.product.update({
          where: {
            id: productId,
            deletedAt: null,
          },
          data: {
            categoryId: input.categoryId,
            title: input.title?.trim(),
            slug:
              input.slug === undefined ? undefined : normalizeSlug(input.slug),
            description:
              input.description === undefined
                ? undefined
                : (input.description?.trim() ?? null),
            basePrice: input.basePrice?.trim(),
            currencyCode: input.currencyCode?.trim().toUpperCase(),
            isActive: input.isActive,
          },
          select: PRODUCT_ADMIN_SELECT,
        });
      }, WRITE_TRANSACTION_OPTIONS);

      await this.invalidateCatalog();
      return this.toAdminView(product);
    } catch (error: unknown) {
      this.rethrowUpdateError(error);
    }
  }

  async softDelete(productId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const product = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
            SELECT id
            FROM products
            WHERE id = ${productId}::uuid
              AND deleted_at IS NULL
            FOR UPDATE
          `);
        if (!product[0]) {
          throw this.productNotFound();
        }

        const deletedAt = new Date();
        await tx.productVariant.updateMany({
          where: {
            productId,
            deletedAt: null,
          },
          data: { deletedAt },
        });
        await tx.product.update({
          where: {
            id: productId,
            deletedAt: null,
          },
          data: {
            isActive: false,
            deletedAt,
          },
          select: { id: true },
        });
      }, WRITE_TRANSACTION_OPTIONS);
      await this.invalidateCatalog();
    } catch (error: unknown) {
      this.rethrowDeleteError(error);
    }
  }

  private async createInTransaction(
    tx: Prisma.TransactionClient,
    input: PreparedProduct,
  ): Promise<ProductCreatedResult> {
    await this.lockActiveCategory(tx, input.categoryId);

    await this.assertAttributeReferences(tx, input);

    const product = await tx.product.create({
      data: {
        categoryId: input.categoryId,
        title: input.title,
        slug: input.slug,
        description: input.description,
        basePrice: input.basePrice,
        currencyCode: input.currencyCode,
        isActive: input.isActive,
      },
      select: {
        id: true,
        slug: true,
      },
    });

    if (input.attributes.length > 0) {
      await tx.productAttributeType.createMany({
        data: input.attributes.map((attribute) => ({
          productId: product.id,
          attributeTypeId: attribute.attributeTypeId,
          sortOrder: attribute.sortOrder,
        })),
      });
    }

    if (input.offeredAttributeValues.length > 0) {
      await tx.productAttributeValue.createMany({
        data: input.offeredAttributeValues.map((option) => ({
          productId: product.id,
          ...option,
        })),
      });
    }

    // Prisma requires this trigger-maintained column in create input. The value
    // is a correct placeholder; PostgreSQL recalculates it before insertion.
    const createdVariants = await tx.productVariant.createManyAndReturn({
      data: input.variants.map((variant) => ({
        productId: product.id,
        sku: variant.sku,
        priceOverride: variant.priceOverride ?? null,
        effectivePrice: variant.priceOverride ?? input.basePrice,
        stockQuantity: variant.stockQuantity,
        isDefault: variant.isDefault,
      })),
      select: {
        id: true,
        sku: true,
      },
    });
    const variantIdsBySku = new Map(
      createdVariants.map((variant) => [normalizeSku(variant.sku), variant.id]),
    );

    const variantOptions = input.variants.flatMap((variant) => {
      const variantId = this.getCreatedVariantId(variantIdsBySku, variant.sku);

      return variant.options.map((option) => ({
        variantId,
        productId: product.id,
        ...option,
      }));
    });
    if (variantOptions.length > 0) {
      await tx.variantAttributeValue.createMany({ data: variantOptions });
    }

    return product;
  }

  private async assertAttributeReferences(
    tx: Prisma.TransactionClient,
    input: PreparedProduct,
  ): Promise<void> {
    if (input.attributes.length === 0) {
      return;
    }

    const attributeTypeIds = input.attributes.map(
      (attribute) => attribute.attributeTypeId,
    );
    const attributeTypes = await tx.attributeType.findMany({
      where: { id: { in: attributeTypeIds } },
      select: { id: true },
    });
    if (attributeTypes.length !== attributeTypeIds.length) {
      throw new BadRequestException(
        'Every attributeTypeId must reference an existing attribute type',
      );
    }

    const attributeValues = await tx.attributeValue.findMany({
      where: {
        id: {
          in: input.offeredAttributeValues.map(
            (option) => option.attributeValueId,
          ),
        },
      },
      select: {
        id: true,
        attributeTypeId: true,
      },
    });
    const valuesById = new Map(
      attributeValues.map((value) => [value.id, value.attributeTypeId]),
    );
    if (
      input.offeredAttributeValues.some(
        (option) =>
          valuesById.get(option.attributeValueId) !== option.attributeTypeId,
      )
    ) {
      throw new BadRequestException(
        'Every option must reference a value belonging to its attribute type',
      );
    }
  }

  private async lockActiveCategory(
    tx: Prisma.TransactionClient,
    categoryId: string,
  ): Promise<void> {
    const category = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id
      FROM categories
      WHERE id = ${categoryId}::uuid
        AND deleted_at IS NULL
      FOR SHARE
    `);
    if (!category[0]) {
      throw new BadRequestException('Category must exist and be active');
    }
  }

  private prepareAndValidate(input: CreateProductDto): PreparedProduct {
    const configuration = prepareVariantConfiguration(
      input.attributes ?? [],
      input.variants,
    );
    return {
      categoryId: input.categoryId,
      title: input.title.trim(),
      slug: normalizeSlug(input.slug),
      description: input.description?.trim() ?? null,
      basePrice: input.basePrice.trim(),
      currencyCode: input.currencyCode.trim().toUpperCase(),
      isActive: input.isActive,
      attributes: configuration.attributes,
      variants: configuration.variants,
      offeredAttributeValues: configuration.offeredAttributeValues,
    };
  }

  private getCreatedVariantId(
    variantIdsBySku: ReadonlyMap<string, string>,
    sku: string,
  ): string {
    const variantId = variantIdsBySku.get(sku);
    if (!variantId) {
      throw new Error('Created product variant could not be resolved');
    }

    return variantId;
  }

  private hasMetadataUpdates(input: UpdateProductDto): boolean {
    return (
      input.categoryId !== undefined ||
      input.title !== undefined ||
      input.slug !== undefined ||
      input.description !== undefined ||
      input.basePrice !== undefined ||
      input.currencyCode !== undefined ||
      input.isActive !== undefined
    );
  }

  private toAdminView(product: ProductAdminRecord): ProductAdminView {
    return {
      ...product,
      basePrice: formatMoney(product.basePrice),
    };
  }

  private rethrowCreateError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (isPrismaKnownRequestError(error, 'P2002')) {
      throw new ConflictException(
        'Product slug, variant SKU, or variant combination is already in use',
      );
    }

    if (
      isPrismaKnownRequestError(error, 'P2003') ||
      isPrismaKnownRequestError(error, 'P2025')
    ) {
      throw new BadRequestException(
        'Category, attribute type, or attribute value reference is invalid',
      );
    }

    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException(
        'Product creation conflicted with another write; please retry',
      );
    }

    const databaseError = getPrismaDatabaseError(error);
    if (databaseError?.code === DATABASE_UNIQUE_VIOLATION) {
      throw new ConflictException(
        'Product slug, variant SKU, or variant combination is already in use',
      );
    }
    if (databaseError?.code === DATABASE_FOREIGN_KEY_VIOLATION) {
      throw new BadRequestException(
        'Category, attribute type, or attribute value reference is invalid',
      );
    }
    if (
      databaseError?.code === PRODUCT_TRIGGER_ERROR_CODE &&
      PRODUCT_INVARIANT_ERRORS.some((message) =>
        databaseError.message.includes(message),
      )
    ) {
      throw new BadRequestException('Invalid product variant configuration');
    }

    throw error;
  }

  private rethrowUpdateError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw this.productNotFound();
    }

    if (isPrismaKnownRequestError(error, 'P2002')) {
      throw new ConflictException('Product slug is already in use');
    }

    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException(
        'Product update conflicted with another write; please retry',
      );
    }

    const databaseError = getPrismaDatabaseError(error);
    if (databaseError?.code === DATABASE_UNIQUE_VIOLATION) {
      throw new ConflictException('Product slug is already in use');
    }
    if (
      databaseError?.code === DATABASE_FOREIGN_KEY_VIOLATION ||
      (databaseError?.code === PRODUCT_TRIGGER_ERROR_CODE &&
        databaseError.message.includes(
          'A non-deleted product must belong to a non-deleted category',
        ))
    ) {
      throw new BadRequestException('Category must exist and be active');
    }
    if (
      databaseError?.code === PRODUCT_TRIGGER_ERROR_CODE &&
      PRODUCT_INVARIANT_ERRORS.some((message) =>
        databaseError.message.includes(message),
      )
    ) {
      throw new BadRequestException(
        'Product cannot be activated until its variant configuration is valid',
      );
    }

    throw error;
  }

  private rethrowDeleteError(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (isPrismaKnownRequestError(error, 'P2025')) {
      throw this.productNotFound();
    }

    if (isPrismaKnownRequestError(error, 'P2034')) {
      throw new ConflictException(
        'Product deletion conflicted with another write; please retry',
      );
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
