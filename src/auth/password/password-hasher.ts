export abstract class PasswordHasher {
  abstract hash(plainTextPassword: string): Promise<string>;

  abstract matches(
    plainTextPassword: string,
    storedHash: string | null,
  ): Promise<boolean>;

  abstract needsRehash(storedHash: string): boolean;
}
