import type { Request } from 'express';
import { extractAccessToken } from './access-token.extractor.js';

function createToken(header: Record<string, unknown>): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from('{}').toString('base64url');

  return `${encodedHeader}.${encodedPayload}.signature`;
}

function requestWithAuthorization(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as Request;
}

describe('extractAccessToken', () => {
  const accessToken = createToken({ alg: 'HS256', typ: 'at+jwt' });

  it('extracts an explicitly typed HS256 bearer access token', () => {
    expect(
      extractAccessToken(requestWithAuthorization(`Bearer ${accessToken}`)),
    ).toBe(accessToken);
  });

  it.each([
    undefined,
    `Basic ${accessToken}`,
    `Bearer ${createToken({ alg: 'HS256', typ: 'JWT' })}`,
    `Bearer ${createToken({ alg: 'HS512', typ: 'at+jwt' })}`,
    'Bearer not-a-jwt',
  ])('rejects a missing or incompatible token', (authorization) => {
    expect(
      extractAccessToken(requestWithAuthorization(authorization)),
    ).toBeNull();
  });
});
