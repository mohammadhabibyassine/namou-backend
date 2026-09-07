import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

describe('RegisterDto', () => {
  it('normalizes user identifiers and Unicode passwords', async () => {
    const input = plainToInstance(RegisterDto, {
      email: ' Customer@Example.COM ',
      password: 'cafe\u0301 is a long password',
      firstName: '  Sara  ',
      lastName: '  Yassine  ',
      phone: '  +961 70 000 000  ',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
    expect(input).toMatchObject({
      email: 'customer@example.com',
      password: 'caf\u00e9 is a long password',
      firstName: 'Sara',
      lastName: 'Yassine',
      phone: '+961 70 000 000',
    });
  });

  it('accepts a long passphrase without composition rules', async () => {
    const input = plainToInstance(RegisterDto, {
      email: 'customer@example.com',
      password: 'only lowercase words with spaces',
    });

    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('rejects passwords shorter than fifteen characters', async () => {
    const input = plainToInstance(RegisterDto, {
      email: 'customer@example.com',
      password: 'too short',
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
