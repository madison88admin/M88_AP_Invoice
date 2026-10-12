import { describe, expect, it } from 'vitest';
import { preferExtractedPaymentTerms } from './vendorDefaultsService';

describe('supplier-list payment-term fallback', () => {
  it('keeps a valid extracted term', () => {
    expect(preferExtractedPaymentTerms('Net 45', 'Net 30')).toBe('Net 45');
    expect(preferExtractedPaymentTerms('30 days net', 'Net 30')).toBe('Net 30 days');
    expect(preferExtractedPaymentTerms('T/T in advance', 'Net 30')).toBe('Payment in Advance');
  });

  it('uses the master default when extraction is blank or unusable', () => {
    expect(preferExtractedPaymentTerms('', 'TT BEFORE SHIPMENT')).toBe('TT BEFORE SHIPMENT');
    expect(preferExtractedPaymentTerms('N/A', 'Net 30')).toBe('Net 30');
    expect(preferExtractedPaymentTerms(null, '30 Days')).toBe('30 Days');
  });

  it('returns null when both sources are unavailable', () => {
    expect(preferExtractedPaymentTerms(undefined, '')).toBeNull();
    expect(preferExtractedPaymentTerms('unrecognized OCR text', 'also unrecognized')).toBeNull();
  });
});
