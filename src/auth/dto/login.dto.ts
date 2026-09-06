import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmail } from '../../common/normalizers/email.normalizer.js';
import { normalizePassword } from '../../common/normalizers/password.normalizer.js';

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Login intentionally does not re-apply registration's 15-character rule:
  // an imported legacy account must be able to authenticate and be upgraded.
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePassword(value) : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
