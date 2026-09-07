export const CacheNamespace = {
  Categories: 'categories',
  ProductCatalog: 'product-catalog',
} as const;

export type CacheNamespaceName =
  (typeof CacheNamespace)[keyof typeof CacheNamespace];

export const CATALOG_CACHE_TTL_MILLISECONDS = 60_000;
