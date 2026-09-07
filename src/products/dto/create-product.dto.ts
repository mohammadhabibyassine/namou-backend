import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { normalizeSku } from '../../common/normalizers/sku.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import {
  MONEY_12_2_PATTERN,
  POSTGRES_INTEGER_MAX,
} from '../../common/validation/input-patterns.js';
import {
  MAX_PRODUCT_ATTRIBUTES,
  MAX_PRODUCT_VARIANTS,
} from '../products.constants.js';
import { ProductMetadataDto } from './product-metadata.dto.js';

const MONEY_VALIDATION_MESSAGE =
  'must be a non-negative amount with at most two decimals';

export class ConfiguredProductAttributeDto {
  @IsUUID('4')
  attributeTypeId: string;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  sortOrder = 0;
}

export class ProductVariantOptionDto {
  @IsUUID('4')
  attributeTypeId: string;

  @IsUUID('4')
  attributeValueId: string;
}

export class CreateProductVariantDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeSku(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(MONEY_12_2_PATTERN, {
    message: `priceOverride ${MONEY_VALIDATION_MESSAGE}`,
  })
  priceOverride?: string | null;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  stockQuantity = 0;

  @IsBoolean()
  isDefault = false;

  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTES)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantOptionDto)
  options: ProductVariantOptionDto[] = [];
}

export class CreateProductDto extends ProductMetadataDto {
  override currencyCode = 'USD';
  override isActive = true;

  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTES)
  @ValidateNested({ each: true })
  @Type(() => ConfiguredProductAttributeDto)
  attributes: ConfiguredProductAttributeDto[] = [];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCT_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants: CreateProductVariantDto[];
}
