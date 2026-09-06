import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  authConfig,
  type AuthConfiguration,
} from '../../config/auth.config.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../auth.types.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TYPE,
} from '../tokens/token.constants.js';
import { isAccessTokenPayload } from './access-token.payload.js';

@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    @Inject(authConfig.KEY) private readonly config: AuthConfiguration,
  ) {}

  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    try {
      const decoded: unknown = this.jwt.decode(token, { complete: true });
      if (!this.hasAccessTokenHeader(decoded)) return null;

      const payload: unknown = await this.jwt.verifyAsync(token, {
        secret: this.config.accessToken.secret,
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        issuer: this.config.accessToken.issuer,
        audience: this.config.accessToken.audience,
      });
      if (!isAccessTokenPayload(payload)) return null;

      return await this.users.findActiveAuthorizationById(payload.sub);
    } catch {
      return null;
    }
  }

  private hasAccessTokenHeader(
    value: unknown,
  ): value is { header: { alg: string; typ: string } } {
    if (!value || typeof value !== 'object' || !('header' in value)) {
      return false;
    }
    const header: unknown = value.header;
    return (
      !!header &&
      typeof header === 'object' &&
      'alg' in header &&
      header.alg === ACCESS_TOKEN_ALGORITHM &&
      'typ' in header &&
      header.typ === ACCESS_TOKEN_TYPE
    );
  }
}
