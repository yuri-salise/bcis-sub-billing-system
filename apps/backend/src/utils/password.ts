import * as argon2 from 'argon2';
import { env } from '../config/env.js';

export interface Argon2Options {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

const DEFAULT_OPTIONS: argon2.HashOptions & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: env.NODE_ENV === 'test' ? 4096 : 19456, // 4 MiB in test, 19 MiB in dev/prod (OWASP recommendation)
  timeCost: env.NODE_ENV === 'test' ? 1 : 2,
  parallelism: 1,
  raw: false,
};

/**
 * Hashes a plaintext password using Argon2id with OWASP-aligned parameters.
 */
export async function hashPassword(password: string, customOptions?: Argon2Options): Promise<string> {
  const options: argon2.HashOptions & { raw: false } = {
    ...DEFAULT_OPTIONS,
    ...customOptions,
    raw: false,
  };
  return argon2.hash(password, options);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * Safely catches malformed hashes and returns false.
 */
export async function verifyPassword(hash: string, plainText: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainText);
  } catch {
    return false;
  }
}

let cachedDummyHash: string | null = null;

/**
 * Executes a dummy verification to mitigate username enumeration via timing attacks.
 */
export async function dummyVerifyPassword(plainText: string): Promise<boolean> {
  if (!cachedDummyHash) {
    cachedDummyHash = await hashPassword('bcis-timing-defense-seed');
  }
  try {
    await argon2.verify(cachedDummyHash, plainText);
  } catch {
    // Ignore
  }
  return false;
}
