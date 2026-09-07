import { IsString, Matches } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'refreshToken must be a valid opaque refresh token',
  })
  refreshToken: string;
}
