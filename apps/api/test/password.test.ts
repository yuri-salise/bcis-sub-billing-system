import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('Password Hashing Utility (Argon2id)', () => {
  it('hashes a plaintext password into a valid Argon2id string', async () => {
    const plainText = 'SecurePassword2026!';
    const hash = await hashPassword(plainText);

    expect(typeof hash).toBe('string');
    // Verify Argon2id prefix ($argon2id$)
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('generates distinct hashes for the same password due to random salting', async () => {
    const password = 'IdenticalPassword123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);
  });

  it('successfully verifies the correct password against its hash', async () => {
    const password = 'CorrectPassword#42';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword(hash, password);
    expect(isValid).toBe(true);
  });

  it('rejects an incorrect password against the hash', async () => {
    const password = 'CorrectPassword#42';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword(hash, 'WrongPassword#99');
    expect(isValid).toBe(false);
  });

  it('returns false for corrupted or malformed hashes without throwing', async () => {
    const isValid = await verifyPassword('not-a-valid-argon2-hash', 'password');
    expect(isValid).toBe(false);
  });

  it('safely performs dummy verification for timing mitigation without throwing', async () => {
    const { dummyVerifyPassword } = await import('../src/utils/password.js');
    const result = await dummyVerifyPassword('any-guess-password');
    expect(result).toBe(false);
  });
});
