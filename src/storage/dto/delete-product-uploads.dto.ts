import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';
import { MAX_PRODUCT_IMAGES } from '../../products/products.constants.js';

export class DeleteProductUploadsDto {
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @IsString({ each: true })
  @MaxLength(512, { each: true })
  objectKeys: string[];
}
