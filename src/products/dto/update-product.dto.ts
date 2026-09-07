import { PartialType } from '@nestjs/mapped-types';
import { ProductMetadataDto } from './product-metadata.dto.js';

// Null is meaningful only for description. For the other metadata fields,
// omission means "unchanged" while an explicit null remains invalid.
export class UpdateProductDto extends PartialType(ProductMetadataDto, {
  skipNullProperties: false,
}) {}
