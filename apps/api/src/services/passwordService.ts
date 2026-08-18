import crypto from 'crypto';

const KEY_LENGTH = 64;
const SCRYPT_PREFIX = 'scrypt';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${SCRYPT_PREFIX}$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): { valid: boolean; needsUpgrade: boolean } {
  if (storedHash.startsWith(`${SCRYPT_PREFIX}$`)) {
    const [, salt, expectedHex] = storedHash.split('$');
    if (!salt || !expectedHex) return { valid: false, needsUpgrade: false };
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return {
      valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual),
      needsUpgrade: false,
    };
  }

  // Transitional verification for existing SHA-256 records. A successful
  // login upgrades the record immediately; new passwords never use SHA-256.
  const legacy = crypto.createHash('sha256').update(password).digest();
  const expected = /^[a-f0-9]{64}$/i.test(storedHash) ? Buffer.from(storedHash, 'hex') : Buffer.alloc(0);
  const valid = expected.length === legacy.length && crypto.timingSafeEqual(expected, legacy);
  return { valid, needsUpgrade: valid };
}
