import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AddWishlistItemDto {
  @IsUUID('4')
  productId: string;

  @IsOptional()
  @IsUUID('4')
  variantId?: string | null;
}

export class MergeWishlistDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddWishlistItemDto)
  items: AddWishlistItemDto[];
}
