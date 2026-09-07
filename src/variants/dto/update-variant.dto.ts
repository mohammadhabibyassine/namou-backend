import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalizeSku } from '../../common/normalizers/sku.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import {
  MONEY_12_2_PATTERN,
  POSTGRES_INTEGER_MAX,
} from '../../common/validation/input-patterns.js';

export class UpdateVariantDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeSku(value) : value,
  )
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  sku?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(MONEY_12_2_PATTERN, {
    message:
      'priceOverride must be a non-negative amount with at most two decimals',
  })
  priceOverride?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  stockQuantity?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  expectedStockQuantity?: number;
}
