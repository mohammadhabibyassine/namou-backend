export interface CartItemView {
  id: string;
  variantId: string;
  quantity: number;
  available: boolean;
  availableQuantity: number;
  unitPrice: string;
  currencyCode: string;
  product: {
    id: string;
    title: string;
    slug: string;
    imageUrl: string | null;
  };
  variant: {
    sku: string;
    options: Array<{ attributeType: string; value: string }>;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface CartView {
  items: CartItemView[];
  itemCount: number;
  quantityTotal: number;
}
