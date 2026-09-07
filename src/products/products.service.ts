import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { compareMoney, formatMoney } from '../common/money/money.js';
import { ApplicationCacheService } from '../cache/application-cache.service.js';
import {
  CacheNamespace,
  CATALOG_CACHE_TTL_MILLISECONDS,
} from '../cache/cache.constants.js';
import type { CursorPage } from '../common/pagination/cursor-page.js';
import { normalizeSlug } from '../common/normalizers/slug.normalizer.js';
import { MONEY_12_2_PATTERN } from '../common/validation/input-patterns.js';
import { ProductSort } from './products.constants.js';
import type { ListProductsQueryDto } from './dto/list-products-query.dto.js';
import type { ProductFacetsQueryDto } from './dto/product-facets-query.dto.js';
import { ProductsRepository } from './products.repository.js';
import type { ProductDetailRecord } from './products.select.js';
import type {
  ProductAttributeView,
  ProductCatalogFacets,
  ProductCatalogQuery,
  ProductDetail,
  ProductListCursor,
  ProductListDatabaseRow,
  ProductListItem,
  ProductVariantOptionView,
  ProductVariantView,
} from './products.types.js';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly cache: ApplicationCacheService,
  ) {}

  async findCatalogPage(
    input: ListProductsQueryDto,
  ): Promise<CursorPage<ProductListItem>> {
    if (
      input.minPrice &&
      input.maxPrice &&
      compareMoney(input.minPrice, input.maxPrice) > 0
    ) {
      throw new BadRequestException(
        'minPrice must be less than or equal to maxPrice',
      );
    }

    const search = input.search?.trim() || undefined;
    const sort =
      input.sort ?? (search ? ProductSort.Relevance : ProductSort.Newest);
    const attributeValueIds = [...new Set(input.attributeValueIds)].sort();
    const filterHash = this.createFilterHash({
      categoryId: input.categoryId,
      search,
      attributeValueIds,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      currencyCode: input.currencyCode,
    });
    const cursor = input.cursor
      ? this.decodeCursor(input.cursor, sort, filterHash)
      : undefined;
    const query: ProductCatalogQuery = {
      categoryId: input.categoryId,
      search,
      attributeValueIds,
      minPrice: input.minPrice,
      maxPrice: input.maxPrice,
      currencyCode: input.currencyCode,
      sort,
      pageSize: input.pageSize,
      cursor,
    };
    return this.cache.remember(
      CacheNamespace.ProductCatalog,
      `page:${JSON.stringify(query)}`,
      CATALOG_CACHE_TTL_MILLISECONDS,
      async () => {
        const rows = await this.productsRepository.findCatalogPage(query);
        const hasNextPage = rows.length > input.pageSize;
        const visibleRows = hasNextPage ? rows.slice(0, input.pageSize) : rows;
        const lastRow = visibleRows.at(-1);

        return {
          items: visibleRows.map((row) => this.toListItem(row)),
          pageInfo: {
            hasNextPage,
            endCursor: lastRow
              ? this.encodeCursor(this.cursorForRow(lastRow, sort, filterHash))
              : null,
          },
        };
      },
    );
  }

  async findCatalogFacets(
    query: ProductFacetsQueryDto,
  ): Promise<ProductCatalogFacets> {
    return this.cache.remember(
      CacheNamespace.ProductCatalog,
      `facets:${JSON.stringify({
        categoryId: query.categoryId ?? null,
        currencyCode: query.currencyCode ?? null,
      })}`,
      CATALOG_CACHE_TTL_MILLISECONDS,
      async () => this.loadCatalogFacets(query),
    );
  }

  private async loadCatalogFacets(
    query: ProductFacetsQueryDto,
  ): Promise<ProductCatalogFacets> {
    const rows = await this.productsRepository.findCatalogFacets(query);
    const attributes = new Map<
      string,
      ProductCatalogFacets['attributes'][number]
    >();
    for (const row of rows.attributes) {
      let attribute = attributes.get(row.attributeTypeId);
      if (!attribute) {
        attribute = {
          id: row.attributeTypeId,
          name: row.attributeTypeName,
          slug: row.attributeTypeSlug,
          sortOrder: row.attributeTypeSortOrder,
          values: [],
        };
        attributes.set(row.attributeTypeId, attribute);
      }
      attribute.values.push({
        id: row.attributeValueId,
        value: row.attributeValue,
        sortOrder: row.attributeValueSortOrder,
      });
    }

    return {
      attributes: [...attributes.values()],
      priceRanges: rows.priceRanges.map((range) => ({
        currencyCode: range.currencyCode,
        minimumPrice: formatMoney(range.minimumPrice),
        maximumPrice: formatMoney(range.maximumPrice),
      })),
    };
  }

  async findBySlug(slug: string): Promise<ProductDetail> {
    const product = await this.productsRepository.findActiveDetailBySlug(
      normalizeSlug(slug),
    );

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.toDetail(product);
  }

  private toListItem(row: ProductListDatabaseRow): ProductListItem {
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      currencyCode: row.currencyCode,
      minimumPrice: formatMoney(row.minimumPrice),
      maximumPrice: formatMoney(row.maximumPrice),
      inStock: row.inStock,
      primaryImageUrl: row.primaryImageUrl,
      category: {
        id: row.categoryId,
        name: row.categoryName,
        slug: row.categorySlug,
      },
      createdAt: row.createdAt,
    };
  }

  private toDetail(product: ProductDetailRecord): ProductDetail {
    const attributes: ProductAttributeView[] = product.attributeTypes.map(
      (configuredType) => ({
        id: configuredType.attributeType.id,
        name: configuredType.attributeType.name,
        slug: configuredType.attributeType.slug,
        sortOrder: configuredType.sortOrder,
        values: configuredType.attributeValues.map(({ attributeValue }) => ({
          id: attributeValue.id,
          value: attributeValue.value,
          sortOrder: attributeValue.sortOrder,
        })),
      }),
    );
    const attributesById = new Map(
      attributes.map((attribute) => [attribute.id, attribute]),
    );
    const valuesById = new Map(
      attributes.flatMap((attribute) =>
        attribute.values.map((value) => [value.id, value] as const),
      ),
    );
    const variants: ProductVariantView[] = product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      priceOverride: variant.priceOverride
        ? formatMoney(variant.priceOverride)
        : null,
      effectivePrice: formatMoney(variant.effectivePrice),
      stockQuantity: variant.stockQuantity,
      isDefault: variant.isDefault,
      options: variant.attributeValues
        .map(({ attributeTypeId, attributeValueId }) => {
          const attribute = attributesById.get(attributeTypeId);
          const value = valuesById.get(attributeValueId);
          if (!attribute || !value) {
            throw new InternalServerErrorException(
              'Product variant configuration is inconsistent',
            );
          }

          return {
            sortOrder: attribute.sortOrder,
            option: {
              attributeTypeId: attribute.id,
              attributeTypeName: attribute.name,
              attributeTypeSlug: attribute.slug,
              attributeValueId: value.id,
              value: value.value,
            } satisfies ProductVariantOptionView,
          };
        })
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(({ option }) => option),
    }));

    return {
      id: product.id,
      title: product.title,
      slug: product.slug,
      description: product.description,
      basePrice: formatMoney(product.basePrice),
      currencyCode: product.currencyCode,
      category: product.category,
      images: product.images,
      attributes,
      variants,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private cursorForRow(
    row: ProductListDatabaseRow,
    sort: ProductCatalogQuery['sort'],
    filterHash: string,
  ): ProductListCursor {
    let value: string;
    switch (sort) {
      case ProductSort.Newest:
        // Use PostgreSQL's textual timestamp, not JavaScript Date, so a cursor
        // keeps all six fractional digits stored by TIMESTAMPTZ(6).
        value = row.cursorCreatedAt;
        break;
      case ProductSort.PriceAscending:
      case ProductSort.PriceDescending:
        value = formatMoney(row.minimumPrice);
        break;
      case ProductSort.Relevance:
        value = String(row.relevance);
        break;
    }

    return { version: 1, sort, filterHash, value, id: row.id };
  }

  private encodeCursor(cursor: ProductListCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(
    encodedCursor: string,
    requestedSort: ProductCatalogQuery['sort'],
    filterHash: string,
  ): ProductListCursor {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encodedCursor)) {
        throw new Error('Invalid base64url');
      }

      const value: unknown = JSON.parse(
        Buffer.from(encodedCursor, 'base64url').toString('utf8'),
      );
      if (
        !this.isCursor(value) ||
        value.sort !== requestedSort ||
        value.filterHash !== filterHash
      ) {
        throw new Error('Invalid product cursor');
      }

      return value;
    } catch {
      throw new BadRequestException(
        'cursor is invalid or does not match the requested sort',
      );
    }
  }

  private isCursor(value: unknown): value is ProductListCursor {
    if (!this.isRecord(value)) {
      return false;
    }

    if (
      value.version !== 1 ||
      !Object.values(ProductSort).includes(
        value.sort as (typeof ProductSort)[keyof typeof ProductSort],
      ) ||
      typeof value.value !== 'string' ||
      typeof value.filterHash !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(value.filterHash) ||
      typeof value.id !== 'string' ||
      !isUUID(value.id, '4')
    ) {
      return false;
    }

    switch (value.sort) {
      case ProductSort.Newest:
        return !Number.isNaN(new Date(value.value).getTime());
      case ProductSort.PriceAscending:
      case ProductSort.PriceDescending:
        return MONEY_12_2_PATTERN.test(value.value);
      case ProductSort.Relevance: {
        const relevance = Number(value.value);
        return Number.isFinite(relevance) && relevance >= 0;
      }
      default:
        return false;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private createFilterHash(
    filters: Pick<
      ProductCatalogQuery,
      | 'categoryId'
      | 'search'
      | 'attributeValueIds'
      | 'minPrice'
      | 'maxPrice'
      | 'currencyCode'
    >,
  ): string {
    return createHash('sha256')
      .update(JSON.stringify(filters))
      .digest('base64url')
      .slice(0, 22);
  }
}
