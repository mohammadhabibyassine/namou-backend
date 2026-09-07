import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, Matches } from 'class-validator';

export class ProductFacetsQueryDto {
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currencyCode must be a three-letter uppercase code',
  })
  currencyCode?: string;
}
