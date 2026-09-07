import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { trimString } from '../../common/normalizers/string.normalizer.js';

export class AddressDataDto {
  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  label?: string | null;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  recipientName: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine1: string;

  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  addressLine2?: string | null;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city: string;

  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state?: string | null;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postalCode: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/, {
    message: 'countryCode must be a two-letter uppercase code',
  })
  countryCode: string;

  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string | null;

  @IsBoolean()
  isDefault = false;
}

export class CreateAddressDto extends AddressDataDto {}

export class UpdateAddressDto extends PartialType(AddressDataDto, {
  skipNullProperties: false,
}) {
  // Do not inherit the create DTO's default in PATCH requests: absence means
  // unchanged, while an explicit false remains meaningful and validated.
  override isDefault: boolean | undefined = undefined;
}
