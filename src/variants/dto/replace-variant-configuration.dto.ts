import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  ConfiguredProductAttributeDto,
  CreateProductVariantDto,
} from '../../products/dto/create-product.dto.js';
import {
  MAX_PRODUCT_ATTRIBUTES,
  MAX_PRODUCT_VARIANTS,
} from '../../products/products.constants.js';

export class ReplacementProductVariantDto extends CreateProductVariantDto {
  @IsOptional()
  @IsUUID('4')
  id?: string;
}

export class ReplaceVariantConfigurationDto {
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTES)
  @ValidateNested({ each: true })
  @Type(() => ConfiguredProductAttributeDto)
  attributes: ConfiguredProductAttributeDto[] = [];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCT_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => ReplacementProductVariantDto)
  variants: ReplacementProductVariantDto[];
}
