import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TYPE,
} from '../tokens/token.constants.js';

const extractBearerToken = ExtractJwt.fromAuthHeaderAsBearerToken();

export function extractAccessToken(request: Request): string | null {
  const token = extractBearerToken(request);

  if (!token) {
    return null;
  }

  const segments = token.split('.');

  if (segments.length !== 3 || !segments[0]) {
    return null;
  }

  try {
    const header = JSON.parse(
      Buffer.from(segments[0], 'base64url').toString('utf8'),
    ) as { alg?: unknown; typ?: unknown };

    return header.alg === ACCESS_TOKEN_ALGORITHM &&
      header.typ === ACCESS_TOKEN_TYPE
      ? token
      : null;
  } catch {
    return null;
  }
}
