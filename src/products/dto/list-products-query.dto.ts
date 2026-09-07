import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { CursorPaginationQueryDto } from '../../common/pagination/cursor-pagination-query.dto.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import { MONEY_12_2_PATTERN } from '../../common/validation/input-patterns.js';
import { ProductSort, type ProductSortValue } from '../products.constants.js';

export class ListProductsQueryDto extends CursorPaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @Transform(({ value }) => parseCommaSeparatedValues(value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  attributeValueIds: string[] = [];

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(MONEY_12_2_PATTERN, {
    message: 'minPrice must be a non-negative amount with at most two decimals',
  })
  minPrice?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @Matches(MONEY_12_2_PATTERN, {
    message: 'maxPrice must be a non-negative amount with at most two decimals',
  })
  maxPrice?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currencyCode must be a three-letter uppercase code',
  })
  currencyCode?: string;

  @IsOptional()
  @IsIn(Object.values(ProductSort))
  sort?: ProductSortValue;
}

function parseCommaSeparatedValues(value: unknown): unknown {
  if (value === undefined) {
    return [];
  }

  const values = Array.isArray(value) ? value : [value];
  if (!values.every((entry) => typeof entry === 'string')) {
    return value;
  }

  return [
    ...new Set(
      values.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()),
    ),
  ].filter(Boolean);
}
