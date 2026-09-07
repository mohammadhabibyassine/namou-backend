import type { CursorPageInfo } from '../common/pagination/cursor-page.js';

export interface WishlistItemView {
  id: string;
  productId: string;
  variantId: string | null;
  available: boolean;
  price: string;
  currencyCode: string;
  product: {
    title: string;
    slug: string;
    imageUrl: string | null;
  };
  variant: {
    sku: string;
    stockQuantity: number;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WishlistView {
  items: WishlistItemView[];
  itemCount: number;
  pageInfo: CursorPageInfo;
}
