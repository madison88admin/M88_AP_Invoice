import { describe, expect, it } from 'vitest';
import { buildMultiInvoiceSourceMetadata, isolateStandaloneInvoice } from './multiInvoiceDetector';

describe('invoice bundled with support pages', () => {
  const page = (...lines: string[]) => ({ lines, text: lines.join(' ') });
  const contract = page('Sales Contract No.: 256451', 'Sales Contract');
  const invoice = page('Invoice No. : 256451', 'Page : Page 1 of 1', 'Invoice', 'T OTAL USD $2,644.80');
  const packing = page('Inv. No.: 256451', 'PACKING LIST');

  it('isolates the payable page when every other page is explicit support', () => {
    expect(isolateStandaloneInvoice([contract, invoice, packing]))
      .toMatchObject({ startPage: 1, endPage: 1, invoiceNumber: '256451' });
  });

  it('keeps ambiguous and continuation pages in the original classification path', () => {
    expect(isolateStandaloneInvoice([invoice, page('Invoice continuation')])).toBeNull();
    expect(isolateStandaloneInvoice([contract, packing])).toBeNull();
    expect(isolateStandaloneInvoice([contract, invoice, invoice])).toBeNull();
  });
});

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
