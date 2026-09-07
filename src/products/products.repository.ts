import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductSort } from './products.constants.js';
import {
  PRODUCT_DETAIL_SELECT,
  type ProductDetailRecord,
} from './products.select.js';
import type {
  ProductAttributeFacetDatabaseRow,
  ProductCatalogQuery,
  ProductListDatabaseRow,
  ProductPriceFacetDatabaseRow,
} from './products.types.js';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveDetailBySlug(slug: string): Promise<ProductDetailRecord | null> {
    return this.prisma.product.findUnique({
      where: {
        slug,
        isActive: true,
        deletedAt: null,
      },
      select: PRODUCT_DETAIL_SELECT,
    });
  }

  async findCatalogFacets(query: {
    categoryId?: string;
    currencyCode?: string;
  }): Promise<{
    attributes: ProductAttributeFacetDatabaseRow[];
    priceRanges: ProductPriceFacetDatabaseRow[];
  }> {
    const categoryFilter = query.categoryId
      ? Prisma.sql`
          AND product.category_id IN (
            SELECT id
            FROM category_subtree(${query.categoryId}::uuid, false)
          )
        `
      : Prisma.empty;
    const currencyFilter = query.currencyCode
      ? Prisma.sql`AND product.currency_code = ${query.currencyCode}`
      : Prisma.empty;

    const [attributes, priceRanges] = await Promise.all([
      this.prisma.$queryRaw<ProductAttributeFacetDatabaseRow[]>(Prisma.sql`
        SELECT DISTINCT
          attribute_type.id AS "attributeTypeId",
          attribute_type.name::text AS "attributeTypeName",
          attribute_type.slug::text AS "attributeTypeSlug",
          attribute_type.sort_order AS "attributeTypeSortOrder",
          attribute_value.id AS "attributeValueId",
          attribute_value.value::text AS "attributeValue",
          attribute_value.sort_order AS "attributeValueSortOrder"
        FROM products AS product
        JOIN categories AS category
          ON category.id = product.category_id
         AND category.deleted_at IS NULL
        JOIN product_variants AS variant
          ON variant.product_id = product.id
         AND variant.deleted_at IS NULL
        JOIN variant_attribute_values AS variant_value
          ON variant_value.variant_id = variant.id
        JOIN attribute_types AS attribute_type
          ON attribute_type.id = variant_value.attribute_type_id
        JOIN attribute_values AS attribute_value
          ON attribute_value.id = variant_value.attribute_value_id
        WHERE product.is_active
          AND product.deleted_at IS NULL
          ${categoryFilter}
          ${currencyFilter}
        ORDER BY
          attribute_type.sort_order,
          attribute_type.name::text,
          attribute_type.id,
          attribute_value.sort_order,
          attribute_value.value::text,
          attribute_value.id
      `),
      this.prisma.$queryRaw<ProductPriceFacetDatabaseRow[]>(Prisma.sql`
        SELECT
          product.currency_code AS "currencyCode",
          min(variant.effective_price) AS "minimumPrice",
          max(variant.effective_price) AS "maximumPrice"
        FROM products AS product
        JOIN categories AS category
          ON category.id = product.category_id
         AND category.deleted_at IS NULL
        JOIN product_variants AS variant
          ON variant.product_id = product.id
         AND variant.deleted_at IS NULL
        WHERE product.is_active
          AND product.deleted_at IS NULL
          ${categoryFilter}
          ${currencyFilter}
        GROUP BY product.currency_code
        ORDER BY product.currency_code
      `),
    ]);

    return { attributes, priceRanges };
  }

  findCatalogPage(
    query: ProductCatalogQuery,
  ): Promise<ProductListDatabaseRow[]> {
    const categoryFilter = query.categoryId
      ? Prisma.sql`
          AND product.category_id IN (
            SELECT id
            FROM category_subtree(${query.categoryId}::uuid, false)
          )
        `
      : Prisma.empty;
    const searchFilter = query.search
      ? Prisma.sql`
          AND product.search_vector @@
            websearch_to_tsquery('simple', ${query.search})
        `
      : Prisma.empty;
    const currencyFilter = query.currencyCode
      ? Prisma.sql`AND product.currency_code = ${query.currencyCode}`
      : Prisma.empty;
    const minimumPriceFilter = query.minPrice
      ? Prisma.sql`
          AND variant.effective_price >= ${query.minPrice}::numeric(12, 2)
        `
      : Prisma.empty;
    const maximumPriceFilter = query.maxPrice
      ? Prisma.sql`
          AND variant.effective_price <= ${query.maxPrice}::numeric(12, 2)
        `
      : Prisma.empty;
    const attributeFilter = query.attributeValueIds.length
      ? Prisma.sql`
          AND filter_stats.found_count = filter_stats.requested_count
          AND (
            SELECT count(DISTINCT variant_value.attribute_type_id)
            FROM variant_attribute_values AS variant_value
            JOIN selected_attribute_values AS selected
              ON selected.attribute_type_id = variant_value.attribute_type_id
             AND selected.id = variant_value.attribute_value_id
            WHERE variant_value.variant_id = variant.id
          ) = filter_stats.requested_type_count
        `
      : Prisma.empty;
    const relevanceExpression = query.search
      ? Prisma.sql`
          ts_rank_cd(
            product.search_vector,
            websearch_to_tsquery('simple', ${query.search})
          )
        `
      : Prisma.sql`0::real`;
    const cursorFilter = this.cursorFilter(query);
    const orderBy = this.orderBy(query.sort);

    return this.prisma.$queryRaw<ProductListDatabaseRow[]>(Prisma.sql`
      WITH requested_attribute_values AS (
        SELECT DISTINCT requested.value_id
        FROM unnest(${query.attributeValueIds}::uuid[]) AS requested(value_id)
      ),
      selected_attribute_values AS (
        SELECT value.id, value.attribute_type_id
        FROM attribute_values AS value
        JOIN requested_attribute_values AS requested
          ON requested.value_id = value.id
      ),
      filter_stats AS (
        SELECT
          (SELECT count(*) FROM requested_attribute_values) AS requested_count,
          count(selected.id) AS found_count,
          count(DISTINCT selected.attribute_type_id) AS requested_type_count
        FROM selected_attribute_values AS selected
      ),
      candidate_products AS (
        SELECT
          product.id,
          product.title,
          product.slug,
          product.currency_code,
          product.created_at,
          category.id AS category_id,
          category.name AS category_name,
          category.slug AS category_slug,
          ${relevanceExpression} AS relevance
        FROM products AS product
        JOIN categories AS category
          ON category.id = product.category_id
         AND category.deleted_at IS NULL
        WHERE product.is_active
          AND product.deleted_at IS NULL
          ${categoryFilter}
          ${currencyFilter}
          ${searchFilter}
      ),
      matching_variants AS (
        SELECT
          variant.product_id,
          variant.effective_price,
          variant.stock_quantity
        FROM product_variants AS variant
        JOIN candidate_products AS product ON product.id = variant.product_id
        CROSS JOIN filter_stats
        WHERE variant.deleted_at IS NULL
          ${minimumPriceFilter}
          ${maximumPriceFilter}
          ${attributeFilter}
      ),
      variant_summary AS (
        SELECT
          variant.product_id,
          min(variant.effective_price) AS minimum_price,
          max(variant.effective_price) AS maximum_price,
          bool_or(variant.stock_quantity > 0) AS in_stock
        FROM matching_variants AS variant
        GROUP BY variant.product_id
      ),
      filtered_products AS (
        SELECT
          product.*,
          summary.minimum_price,
          summary.maximum_price,
          summary.in_stock,
          image.image_url AS primary_image_url
        FROM candidate_products AS product
        JOIN variant_summary AS summary ON summary.product_id = product.id
        LEFT JOIN LATERAL (
          SELECT product_image.image_url
          FROM product_images AS product_image
          WHERE product_image.product_id = product.id
          ORDER BY product_image.sort_order, product_image.id
          LIMIT 1
        ) AS image ON true
      )
      SELECT
        filtered.id,
        filtered.title,
        filtered.slug::text AS slug,
        filtered.currency_code AS "currencyCode",
        filtered.minimum_price AS "minimumPrice",
        filtered.maximum_price AS "maximumPrice",
        filtered.in_stock AS "inStock",
        filtered.primary_image_url AS "primaryImageUrl",
        filtered.category_id AS "categoryId",
        filtered.category_name AS "categoryName",
        filtered.category_slug::text AS "categorySlug",
        filtered.relevance,
        filtered.created_at AS "createdAt",
        to_char(
          filtered.created_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) AS "cursorCreatedAt"
      FROM filtered_products AS filtered
      ${cursorFilter}
      ORDER BY ${orderBy}
      LIMIT ${query.pageSize + 1}
    `);
  }

  private cursorFilter(query: ProductCatalogQuery): Prisma.Sql {
    if (!query.cursor) {
      return Prisma.empty;
    }

    const { id, value } = query.cursor;
    switch (query.sort) {
      case ProductSort.Newest:
        return Prisma.sql`
          WHERE (filtered.created_at, filtered.id) <
            (${value}::timestamptz, ${id}::uuid)
        `;
      case ProductSort.PriceAscending:
        return Prisma.sql`
          WHERE (filtered.minimum_price, filtered.id) >
            (${value}::numeric(12, 2), ${id}::uuid)
        `;
      case ProductSort.PriceDescending:
        return Prisma.sql`
          WHERE (filtered.minimum_price, filtered.id) <
            (${value}::numeric(12, 2), ${id}::uuid)
        `;
      case ProductSort.Relevance:
        return Prisma.sql`
          WHERE (filtered.relevance, filtered.id) <
            (${Number(value)}::real, ${id}::uuid)
        `;
    }
  }

  private orderBy(sort: ProductCatalogQuery['sort']): Prisma.Sql {
    switch (sort) {
      case ProductSort.Newest:
        return Prisma.sql`filtered.created_at DESC, filtered.id DESC`;
      case ProductSort.PriceAscending:
        return Prisma.sql`filtered.minimum_price ASC, filtered.id ASC`;
      case ProductSort.PriceDescending:
        return Prisma.sql`filtered.minimum_price DESC, filtered.id DESC`;
      case ProductSort.Relevance:
        return Prisma.sql`filtered.relevance DESC, filtered.id DESC`;
    }
  }
}
