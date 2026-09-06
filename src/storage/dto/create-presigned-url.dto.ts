import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  Max,
  Min,
} from 'class-validator';
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_PRODUCT_IMAGE_SIZE_BYTES,
  type AllowedImageContentType,
} from '../storage.constants.js';

export class CreatePresignedUrlDto {
  @IsIn(ALLOWED_IMAGE_CONTENT_TYPES)
  contentType: AllowedImageContentType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PRODUCT_IMAGE_SIZE_BYTES)
  fileSizeBytes: number;
}
