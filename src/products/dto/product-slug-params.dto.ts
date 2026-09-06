import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeSlug } from '../../common/normalizers/slug.normalizer.js';
import {
  SLUG_PATTERN,
  SLUG_VALIDATION_MESSAGE,
} from '../../common/validation/input-patterns.js';

export class ProductSlugParamsDto {
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
}
