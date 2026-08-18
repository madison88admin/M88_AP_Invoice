import { describe, expect, it } from 'vitest';
import { bankAccountFingerprint, maskBankAccount } from './sensitiveData';

describe('sensitive bank data', () => {
  it('never returns a complete account number', () => expect(maskBankAccount('1234 5678 9012')).toBe('********9012'));
  it('normalizes account identity for duplicate-bank controls', () => expect(bankAccountFingerprint('12-34 5678')).toBe('12345678'));
});
