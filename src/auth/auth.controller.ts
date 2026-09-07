import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedUser, AuthSessionResult } from './auth.types.js';
import type {
  LoginResult,
  RegistrationResult,
  TokenPair,
} from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from './decorators/public.decorator.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Public()
  register(@Body() input: RegisterDto): Promise<RegistrationResult> {
    return this.authService.register(input);
  }

  @Get('session')
  session(@CurrentUser() user: AuthenticatedUser): AuthSessionResult {
    return {
      user: {
        id: user.userId,
        role: user.roleName,
        permissions: user.permissions,
      },
    };
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  login(
    @Body() input: LoginDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<LoginResult> {
    return this.authService.login(input, { deviceInfo: userAgent });
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body() input: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TokenPair> {
    return this.authService.refresh(input, { deviceInfo: userAgent });
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() input: RefreshTokenDto): Promise<void> {
    return this.authService.logout(input);
  }
}
