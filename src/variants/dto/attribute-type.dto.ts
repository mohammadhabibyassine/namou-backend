import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { normalizeSlug } from '../../common/normalizers/slug.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import {
  POSTGRES_INTEGER_MAX,
  SLUG_PATTERN,
  SLUG_VALIDATION_MESSAGE,
} from '../../common/validation/input-patterns.js';

export class AttributeTypeDataDto {
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

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  sortOrder = 0;
}

export class CreateAttributeTypeDto extends AttributeTypeDataDto {}

export class UpdateAttributeTypeDto extends PartialType(AttributeTypeDataDto, {
  skipNullProperties: false,
}) {
  // Mapped types inherit base-class field initializers. A PATCH DTO must not
  // treat an omitted sortOrder as an explicit zero.
  override sortOrder: number | undefined = undefined;
}

export class AttributeValueDataDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  value: string;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  sortOrder = 0;
}

export class CreateAttributeValueDto extends AttributeValueDataDto {}

export class UpdateAttributeValueDto extends PartialType(
  AttributeValueDataDto,
  { skipNullProperties: false },
) {
  override sortOrder: number | undefined = undefined;
}
