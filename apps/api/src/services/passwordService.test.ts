import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwordService';

describe('passwordService', () => {
  it('stores new passwords with a salted scrypt hash', () => {
    const first = hashPassword('correct horse battery staple');
    const second = hashPassword('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
    expect(verifyPassword('correct horse battery staple', first)).toEqual({ valid: true, needsUpgrade: false });
    expect(verifyPassword('wrong', first).valid).toBe(false);
  });

  it('accepts a valid legacy SHA-256 hash once and requests an upgrade', () => {
    const legacy = crypto.createHash('sha256').update('legacy-password').digest('hex');
    expect(verifyPassword('legacy-password', legacy)).toEqual({ valid: true, needsUpgrade: true });
  });
});
