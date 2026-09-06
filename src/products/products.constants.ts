export const ProductSort = {
  Newest: 'newest',
  PriceAscending: 'price_asc',
  PriceDescending: 'price_desc',
  Relevance: 'relevance',
} as const;

export type ProductSortValue = (typeof ProductSort)[keyof typeof ProductSort];

export const MAX_PRODUCT_ATTRIBUTES = 20;
export const MAX_PRODUCT_VARIANTS = 100;
export const MAX_PRODUCT_IMAGES = 50;
