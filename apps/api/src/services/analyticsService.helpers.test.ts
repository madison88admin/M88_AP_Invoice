import { describe, expect, it } from 'vitest';
import { normalizeVendorKey } from './analyticsService';

describe('analytics normalization helpers', () => {
  it('merges punctuation and legal-suffix variants of the same vendor', () => {
    const variants = [
      normalizeVendorKey('PT. UWU JUMP INDONESIA'),
      normalizeVendorKey('PT.UWU JUMP INDONESIA'),
      normalizeVendorKey('PTUWUJUMPINDONESIA'),
    ];
    expect(new Set(variants).size).toBe(1);
  });
});
