import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeSlug } from '../../common/normalizers/slug.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import {
  MONEY_12_2_PATTERN,
  SLUG_PATTERN,
  SLUG_VALIDATION_MESSAGE,
} from '../../common/validation/input-patterns.js';

export class ProductMetadataDto {
  @IsUUID('4')
  categoryId: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeSlug(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(SLUG_PATTERN, {
    message: `slug ${SLUG_VALIDATION_MESSAGE}`,
  })
  slug: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string | null;

  @Transform(({ value }) => trimString(value))
  @Matches(MONEY_12_2_PATTERN, {
    message:
      'basePrice must be a non-negative amount with at most two decimals',
  })
  basePrice: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/, {
    message: 'currencyCode must be a three-letter uppercase code',
  })
  currencyCode: string;

  @IsBoolean()
  isActive: boolean;
}
