import { describe, expect, it } from 'vitest';
import { parseMPOReference } from './mpoReference';
import { extractMPONumber } from '../services/madisonInvoiceExtractor';

describe('parseMPOReference', () => {
  it('splits a combined MPO line and material reference', () => {
    expect(parseMPOReference('mpo015958-1-zvt000123')).toEqual({
      raw: 'MPO015958-1-ZVT000123',
      baseMpo: 'MPO015958',
      orderSequence: '1',
      materialCode: 'ZVT000123',
    });
  });

  it('preserves a base-only MPO reference', () => {
    expect(parseMPOReference('MPO015958')).toEqual({
      raw: 'MPO015958',
      baseMpo: 'MPO015958',
      orderSequence: undefined,
      materialCode: undefined,
    });
  });

  it('extracts the complete combined reference from invoice text', () => {
    expect(extractMPONumber('Order reference: MPO015958-1-ZVT000123').value)
      .toBe('MPO015958-1-ZVT000123');
  });
});
