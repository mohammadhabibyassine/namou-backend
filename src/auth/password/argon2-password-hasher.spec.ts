import * as argon2 from 'argon2';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const passwordHasher = new Argon2PasswordHasher();
  const password = 'a correct horse battery staple';

  it('creates an Argon2id hash using the configured work factors', async () => {
    const passwordHash = await passwordHasher.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).toContain('m=19456');
    expect(passwordHash).toContain('t=2');
    expect(passwordHash).toContain('p=1');
  });

  it('matches the correct password and rejects an incorrect password', async () => {
    const passwordHash = await passwordHasher.hash(password);

    await expect(passwordHasher.matches(password, passwordHash)).resolves.toBe(
      true,
    );
    await expect(
      passwordHasher.matches('incorrect-password', passwordHash),
    ).resolves.toBe(false);
  });

  it('performs dummy verification and returns false for a missing account', async () => {
    await expect(passwordHasher.matches(password, null)).resolves.toBe(false);
  });

  it('normalizes canonically equivalent Unicode passwords', async () => {
    const composed = 'caf\u00e9 is a long password';
    const decomposed = 'cafe\u0301 is a long password';
    const passwordHash = await passwordHasher.hash(composed);

    await expect(
      passwordHasher.matches(decomposed, passwordHash),
    ).resolves.toBe(true);
  });

  it('detects hashes that need an algorithm or work-factor upgrade', async () => {
    const currentHash = await passwordHasher.hash(password);
    const legacyHash = await argon2.hash(password, {
      type: argon2.argon2i,
      memoryCost: 12 * 1024,
      timeCost: 3,
      parallelism: 1,
    });

    expect(passwordHasher.needsRehash(currentHash)).toBe(false);
    expect(passwordHasher.needsRehash(legacyHash)).toBe(true);
  });
});
