import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizeSlug } from '../../common/normalizers/slug.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import {
  SLUG_PATTERN,
  SLUG_VALIDATION_MESSAGE,
} from '../../common/validation/input-patterns.js';

const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class CreateCategoryDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

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

  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(POSTGRES_INTEGER_MIN)
  @Max(POSTGRES_INTEGER_MAX)
  sortOrder?: number;
}
