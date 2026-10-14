import { describe, expect, it } from 'vitest';
import { buildDuplicateIndicators, calculateRetentionUntil, normalizeInvoiceReference } from './accountingControlService';

describe('accounting deep-dive controls', () => {
  it('normalizes revision suffixes without changing the printed reference', () => {
    expect(normalizeInvoiceReference('0001-A')).toBe('1A');
    expect(normalizeInvoiceReference('INV-0001-REV')).toBe('INV1');
    expect(normalizeInvoiceReference('  PCI / 2604 0479 ')).toBe('PCI26040479');
  });

  it('sets retention at least seven years from the record date', () => {
    const start = new Date('2026-10-14T00:00:00.000Z');
    expect(calculateRetentionUntil(start).toISOString()).toBe('2033-10-14T00:00:00.000Z');
  });

  it('exposes matching indicators for revision review', () => {
    const indicators = buildDuplicateIndicators({
      existing: {
        vendor_id: 'v1',
        invoice_number: 'INV-0001',
        mpo_number: 'MPO123456',
        invoice_date: new Date('2026-10-01'),
        total_amount: 100,
        currency: 'USD',
      },
      incoming: {
        vendor_id: 'v1',
        invoice_number: 'INV-0001-REV',
        mpo_number: 'MPO123456',
        invoice_date: new Date('2026-10-01'),
        total_amount: 100,
        currency: 'USD',
      },
    });
    expect(indicators.same_vendor).toBe(true);
    expect(indicators.same_normalized_reference).toBe(true);
    expect(indicators.same_mpo_po).toBe(true);
    expect(indicators.same_amount_currency).toBe(true);
    expect(indicators.same_line_details).toBe(false);
    expect(indicators.same_document_similarity).toBe(false);
  });
});

