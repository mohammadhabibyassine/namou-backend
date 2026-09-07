import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';

describe('LoginDto', () => {
  it('normalizes email and canonically equivalent Unicode passwords', async () => {
    const input = plainToInstance(LoginDto, {
      email: ' Customer@Example.COM ',
      password: 'cafe\u0301 password',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      email: 'customer@example.com',
      password: 'caf\u00e9 password',
    });
  });

  it('allows a non-empty legacy password below the registration minimum', async () => {
    const input = plainToInstance(LoginDto, {
      email: 'customer@example.com',
      password: 'legacy',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('rejects an empty password', async () => {
    const input = plainToInstance(LoginDto, {
      email: 'customer@example.com',
      password: '',
    });

    const errors = await validate(input);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'password',
          constraints: expect.objectContaining({
            minLength: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
