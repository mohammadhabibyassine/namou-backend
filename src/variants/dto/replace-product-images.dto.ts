import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trimString } from '../../common/normalizers/string.normalizer.js';
import { POSTGRES_INTEGER_MAX } from '../../common/validation/input-patterns.js';
import { MAX_PRODUCT_IMAGES } from '../../products/products.constants.js';

export class ReplacementProductImageDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(2_048)
  imageUrl: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  altText?: string | null;

  @IsInt()
  @Min(0)
  @Max(POSTGRES_INTEGER_MAX)
  sortOrder: number;

  @IsOptional()
  @IsUUID('4')
  variantId?: string | null;
}

export class ReplaceProductImagesDto {
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => ReplacementProductImageDto)
  images: ReplacementProductImageDto[] = [];
}
