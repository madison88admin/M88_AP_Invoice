import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeName, resolveName, namesEquivalent, createAlias } from './aliasService';

describe('aliasService — normalization + equivalence', () => {
  it('normalizes case and collapses whitespace', () => {
    expect(normalizeName('  J-LONG   LTD. ')).toBe('j-long ltd.');
    expect(normalizeName('')).toBe('');
  });

  it('resolves a known alias to its canonical spelling', () => {
    const map = new Map<string, string>([['j-long ltd.', 'J-Long Ltd']]);
    expect(resolveName('J-LONG LTD.', map)).toBe('J-Long Ltd');
    expect(resolveName('Unlisted Vendor', map)).toBe('Unlisted Vendor');
  });

  it('treats formatting variants as equivalent via the alias table', () => {
    const map = new Map<string, string>([['j-long ltd.', 'J-Long Ltd']]);
    expect(namesEquivalent('J-LONG LTD.', 'J-Long Ltd', map)).toBe(true);
    expect(namesEquivalent('Rossignol', 'ROSSIGNOL', new Map())).toBe(true); // case-only
  });

  it('treats different vendors as non-equivalent when no alias exists', () => {
    expect(namesEquivalent('Vendor A', 'Vendor B', new Map())).toBe(false);
  });

  it('never flags blank sides as a mismatch', () => {
    expect(namesEquivalent('', 'Vendor A', new Map())).toBe(true);
    expect(namesEquivalent(null, undefined, new Map())).toBe(true);
  });
});

describe('aliasService — CRUD validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an invalid entity type', async () => {
    await expect(createAlias('COLOR', 'Red', 'Red.')).rejects.toThrow(/Invalid entity_type/);
  });

  it('rejects an empty alias or canonical', async () => {
    await expect(createAlias('VENDOR', '', 'Variant')).rejects.toThrow(/required/);
    await expect(createAlias('VENDOR', 'Canon', '  ')).rejects.toThrow(/required/);
  });

  it('rejects an alias identical to the canonical name', async () => {
    await expect(createAlias('VENDOR', 'J-Long Ltd', 'j-long ltd')).rejects.toThrow(/must differ/);
  });

  it('returns HTTP 400 (AppError) for validation failures, not 500', async () => {
    try {
      await createAlias('VENDOR', 'J-Long Ltd', 'j-long ltd');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
      expect(e.isOperational).toBe(true);
    }
    try {
      await createAlias('COLOR', 'Red', 'Red.');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
    }
  });
});
