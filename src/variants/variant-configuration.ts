import { BadRequestException } from '@nestjs/common';
import { normalizeSku } from '../common/normalizers/sku.normalizer.js';

export interface VariantConfigurationAttributeInput {
  attributeTypeId: string;
  sortOrder: number;
}

export interface VariantConfigurationOptionInput {
  attributeTypeId: string;
  attributeValueId: string;
}

export interface VariantConfigurationVariantInput {
  id?: string;
  sku: string;
  priceOverride?: string | null;
  stockQuantity: number;
  isDefault: boolean;
  options: VariantConfigurationOptionInput[];
}

export interface OfferedAttributeValue {
  attributeTypeId: string;
  attributeValueId: string;
}

export interface PreparedVariantConfiguration<
  TVariant extends VariantConfigurationVariantInput,
> {
  attributes: VariantConfigurationAttributeInput[];
  variants: Array<
    Omit<TVariant, 'sku' | 'priceOverride' | 'options'> & {
      sku: string;
      priceOverride: string | null;
      options: VariantConfigurationOptionInput[];
    }
  >;
  offeredAttributeValues: OfferedAttributeValue[];
}

/**
 * Validates rules shared by initial product creation and later replacement of
 * its complete variant matrix. PostgreSQL repeats the critical checks at
 * commit; this provides precise request errors before opening a transaction.
 */
export function prepareVariantConfiguration<
  TVariant extends VariantConfigurationVariantInput,
>(
  attributesInput: readonly VariantConfigurationAttributeInput[],
  variantsInput: readonly TVariant[],
): PreparedVariantConfiguration<TVariant> {
  const attributes = attributesInput.map((attribute) => ({ ...attribute }));
  const variants = variantsInput.map((variant) => ({
    ...variant,
    sku: normalizeSku(variant.sku),
    priceOverride: variant.priceOverride?.trim() ?? null,
    options: (variant.options ?? []).map((option) => ({ ...option })),
  }));
  const attributeTypeIds = new Set(
    attributes.map((attribute) => attribute.attributeTypeId),
  );

  if (attributeTypeIds.size !== attributes.length) {
    throw new BadRequestException(
      'Configured product attribute types must be unique',
    );
  }

  const variantIds = variants.flatMap((variant) =>
    variant.id ? [variant.id] : [],
  );
  if (new Set(variantIds).size !== variantIds.length) {
    throw new BadRequestException('Existing variant IDs must be unique');
  }

  const skus = new Set(variants.map((variant) => variant.sku));
  if (skus.size !== variants.length) {
    throw new BadRequestException('Variant SKUs must be unique');
  }

  if (variants.filter((variant) => variant.isDefault).length !== 1) {
    throw new BadRequestException(
      'A product must have exactly one default variant',
    );
  }

  if (attributes.length === 0 && variants.length !== 1) {
    throw new BadRequestException(
      'A product without attributes must have exactly one variant',
    );
  }

  const offeredAttributeValues = new Map<string, OfferedAttributeValue>();
  const combinationSignatures = new Set<string>();
  for (const variant of variants) {
    const optionTypeIds = new Set(
      variant.options.map((option) => option.attributeTypeId),
    );
    const hasExactAttributeTypes =
      optionTypeIds.size === attributeTypeIds.size &&
      [...optionTypeIds].every((id) => attributeTypeIds.has(id));
    if (
      optionTypeIds.size !== variant.options.length ||
      !hasExactAttributeTypes
    ) {
      throw new BadRequestException(
        `Variant ${variant.sku} must have exactly one option for every configured attribute type`,
      );
    }

    const signature = variant.options
      .map((option) => `${option.attributeTypeId}:${option.attributeValueId}`)
      .sort()
      .join('|');
    if (combinationSignatures.has(signature)) {
      throw new BadRequestException(
        'Variant attribute combinations must be unique',
      );
    }
    combinationSignatures.add(signature);

    for (const option of variant.options) {
      offeredAttributeValues.set(
        `${option.attributeTypeId}:${option.attributeValueId}`,
        option,
      );
    }
  }

  return {
    attributes,
    variants,
    offeredAttributeValues: [...offeredAttributeValues.values()],
  };
}
