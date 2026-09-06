import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { trimString } from '../../common/normalizers/string.normalizer.js';

export class CheckoutDto {
  @IsUUID('4')
  addressId: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5_000)
  notes?: string | null;
}
