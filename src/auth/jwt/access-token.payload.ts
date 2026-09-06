import { isUUID } from 'class-validator';

export interface AccessTokenPayload {
  sub: string;
  jti: string;
  iss: string;
  aud: string | string[];
  iat: number;
  exp: number;
}

export function isAccessTokenPayload(
  payload: unknown,
): payload is AccessTokenPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<AccessTokenPayload>;

  return (
    typeof candidate.sub === 'string' &&
    isUUID(candidate.sub, '4') &&
    typeof candidate.jti === 'string' &&
    isUUID(candidate.jti, '4') &&
    typeof candidate.iss === 'string' &&
    (typeof candidate.aud === 'string' ||
      (Array.isArray(candidate.aud) &&
        candidate.aud.length > 0 &&
        candidate.aud.every((audience) => typeof audience === 'string'))) &&
    Number.isInteger(candidate.iat) &&
    Number.isInteger(candidate.exp) &&
    (candidate.exp as number) > (candidate.iat as number)
  );
}
