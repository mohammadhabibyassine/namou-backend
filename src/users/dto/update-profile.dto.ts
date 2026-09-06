import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { trimString } from '../../common/normalizers/string.normalizer.js';

export class UpdateProfileDto {
  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string | null;

  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string | null;

  @Transform(({ value }) => trimString(value))
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string | null;
}
