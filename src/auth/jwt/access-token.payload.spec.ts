import { isAccessTokenPayload } from './access-token.payload.js';

const validPayload = {
  sub: '11111111-1111-4111-8111-111111111111',
  jti: '22222222-2222-4222-8222-222222222222',
  iss: 'namou',
  aud: 'namou-api',
  iat: 1_700_000_000,
  exp: 1_700_000_900,
};

describe('isAccessTokenPayload', () => {
  it('accepts the complete access-token claim contract', () => {
    expect(isAccessTokenPayload(validPayload)).toBe(true);
    expect(isAccessTokenPayload({ ...validPayload, aud: ['namou-api'] })).toBe(
      true,
    );
  });

  it.each([
    null,
    {},
    { ...validPayload, sub: 'not-a-uuid' },
    { ...validPayload, jti: undefined },
    { ...validPayload, iat: '1700000000' },
    { ...validPayload, exp: validPayload.iat },
    { ...validPayload, aud: [] },
  ])('rejects malformed claims', (payload) => {
    expect(isAccessTokenPayload(payload)).toBe(false);
  });
});
