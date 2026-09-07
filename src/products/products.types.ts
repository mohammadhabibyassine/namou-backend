import type { Prisma } from '../generated/prisma/client.js';
import type { ProductSortValue } from './products.constants.js';

export interface ProductCategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface ProductImageView {
  id: string;
  variantId: string | null;
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
}

export interface ProductAttributeValueView {
  id: string;
  value: string;
  sortOrder: number;
}

export interface ProductAttributeView {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  values: ProductAttributeValueView[];
}

export interface ProductVariantOptionView {
  attributeTypeId: string;
  attributeTypeName: string;
  attributeTypeSlug: string;
  attributeValueId: string;
  value: string;
}

export interface ProductVariantView {
  id: string;
  sku: string;
  priceOverride: string | null;
  effectivePrice: string;
  stockQuantity: number;
  isDefault: boolean;
  options: ProductVariantOptionView[];
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  basePrice: string;
  currencyCode: string;
  category: ProductCategorySummary;
  images: ProductImageView[];
  attributes: ProductAttributeView[];
  variants: ProductVariantView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListItem {
  id: string;
  title: string;
  slug: string;
  currencyCode: string;
  minimumPrice: string;
  maximumPrice: string;
  inStock: boolean;
  primaryImageUrl: string | null;
  category: ProductCategorySummary;
  createdAt: Date;
}

export interface ProductListDatabaseRow {
  id: string;
  title: string;
  slug: string;
  currencyCode: string;
  minimumPrice: Prisma.Decimal;
  maximumPrice: Prisma.Decimal;
  inStock: boolean;
  primaryImageUrl: string | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  relevance: number;
  createdAt: Date;
  cursorCreatedAt: string;
}

export interface ProductListCursor {
  version: 1;
  sort: ProductSortValue;
  filterHash: string;
  value: string;
  id: string;
}

export interface ProductCatalogQuery {
  categoryId?: string;
  search?: string;
  attributeValueIds: string[];
  minPrice?: string;
  maxPrice?: string;
  currencyCode?: string;
  sort: ProductSortValue;
  pageSize: number;
  cursor?: ProductListCursor;
}

export interface ProductCreatedResult {
  id: string;
  slug: string;
}

export interface ProductAdminView {
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string | null;
  basePrice: string;
  currencyCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductAttributeFacetDatabaseRow {
  attributeTypeId: string;
  attributeTypeName: string;
  attributeTypeSlug: string;
  attributeTypeSortOrder: number;
  attributeValueId: string;
  attributeValue: string;
  attributeValueSortOrder: number;
}

export interface ProductPriceFacetDatabaseRow {
  currencyCode: string;
  minimumPrice: Prisma.Decimal;
  maximumPrice: Prisma.Decimal;
}

export interface ProductCatalogFacets {
  attributes: Array<{
    id: string;
    name: string;
    slug: string;
    sortOrder: number;
    values: Array<{
      id: string;
      value: string;
      sortOrder: number;
    }>;
  }>;
  priceRanges: Array<{
    currencyCode: string;
    minimumPrice: string;
    maximumPrice: string;
  }>;
}
