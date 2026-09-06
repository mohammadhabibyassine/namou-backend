import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import {
  authConfig,
  type AuthConfiguration,
} from '../../config/auth.config.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../auth.types.js';
import { ACCESS_TOKEN_ALGORITHM } from '../tokens/token.constants.js';
import { extractAccessToken } from './access-token.extractor.js';
import { isAccessTokenPayload } from './access-token.payload.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(authConfig.KEY) config: AuthConfiguration,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: extractAccessToken,
      secretOrKey: config.accessToken.secret,
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      issuer: config.accessToken.issuer,
      audience: config.accessToken.audience,
      ignoreExpiration: false,
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (!isAccessTokenPayload(payload)) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findActiveAuthorizationById(
      payload.sub,
    );

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
