import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeEmail } from '../../common/normalizers/email.normalizer.js';
import { normalizePassword } from '../../common/normalizers/password.normalizer.js';
import { trimString } from '../../common/normalizers/string.normalizer.js';

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePassword(value) : value,
  )
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  phone?: string;
}
