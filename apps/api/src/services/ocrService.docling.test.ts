import { describe, expect, it } from 'vitest';
import { shouldRunDoclingFallback } from './ocrService';

describe('shouldRunDoclingFallback', () => {
  it('triggers when the invoice number is missing (SFTP-<ts> class of bug)', () => {
    expect(shouldRunDoclingFallback({ vendor_name: 'PT. PAXAR INDONESIA', invoice_number: '', amount: 54.82 })).toBe(true);
    expect(shouldRunDoclingFallback({ vendor_name: 'PT. PAXAR INDONESIA', invoice_number: '  ', amount: 54.82 })).toBe(true);
  });

  it('triggers when the vendor is missing', () => {
    expect(shouldRunDoclingFallback({ vendor_name: '', invoice_number: 'PCI-26031836', amount: 54.82 })).toBe(true);
  });

  it('triggers when the amount is missing or invalid', () => {
    expect(shouldRunDoclingFallback({ vendor_name: 'Acme', invoice_number: 'INV-1', amount: 0 })).toBe(true);
    expect(shouldRunDoclingFallback({ vendor_name: 'Acme', invoice_number: 'INV-1', amount: NaN })).toBe(true);
  });

  it('does not trigger when all critical fields are present', () => {
    expect(shouldRunDoclingFallback({ vendor_name: 'Acme', invoice_number: 'INV-1', amount: 100.5 })).toBe(false);
  });

  it('triggers for a null extraction', () => {
    expect(shouldRunDoclingFallback(null)).toBe(true);
    expect(shouldRunDoclingFallback(undefined)).toBe(true);
  });
});
