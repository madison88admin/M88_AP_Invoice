import { describe, expect, it } from 'vitest';
import { buildMultiInvoiceSourceMetadata } from './multiInvoiceDetector';

describe('multi-invoice lineage metadata', () => {
  it('preserves source hash and one-based page boundaries', () => {
    const metadata = buildMultiInvoiceSourceMetadata(Buffer.from('source-pdf'), { startPage: 1, endPage: 3, invoiceNumber: 'INV-2', vendorName: 'Vendor', amount: 10, pageText: '' }, 1, 3);
    expect(metadata.source_page_start).toBe(2);
    expect(metadata.source_page_end).toBe(4);
    expect(metadata.source_page_count).toBe(3);
    expect(metadata.split_index).toBe(1);
    expect(metadata.source_pdf_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
