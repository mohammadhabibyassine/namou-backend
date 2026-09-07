export interface AttributeValueView {
  id: string;
  attributeTypeId?: string;
  value: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttributeTypeView {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  values: AttributeValueView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminVariantView {
  id: string;
  productId: string;
  sku: string;
  priceOverride: string | null;
  effectivePrice: string;
  stockQuantity: number;
  isDefault: boolean;
  options: Array<{
    attributeTypeId: string;
    attributeValueId: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductImageAdminView {
  id: string;
  productId: string;
  variantId: string | null;
  imageUrl: string;
  altText: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantConfigurationView {
  attributes: Array<{ attributeTypeId: string; sortOrder: number }>;
  variants: AdminVariantView[];
}
