import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { normalizePassword } from '../../common/normalizers/password.normalizer.js';
import { PasswordHasher } from './password-hasher.js';

const ARGON2ID_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

// A valid hash used only when an email has no matching account. Verification
// still performs the expensive Argon2 operation, but matches() always returns
// false when the caller supplied no stored hash.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$GDcZWYs6sGoy4MBMv81J8Q$6zfbvANqLoSSEI3l2KK67r0GnLERb6cAv0Zqz2oL+5o';

@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  hash(plainTextPassword: string): Promise<string> {
    return argon2.hash(normalizePassword(plainTextPassword), ARGON2ID_OPTIONS);
  }

  async matches(
    plainTextPassword: string,
    storedHash: string | null,
  ): Promise<boolean> {
    const matches = await argon2.verify(
      storedHash ?? DUMMY_PASSWORD_HASH,
      normalizePassword(plainTextPassword),
    );

    return storedHash !== null && matches;
  }

  needsRehash(storedHash: string): boolean {
    return (
      !storedHash.startsWith('$argon2id$') ||
      argon2.needsRehash(storedHash, ARGON2ID_OPTIONS)
    );
  }
}
