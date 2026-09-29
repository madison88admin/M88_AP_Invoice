import { describe, expect, it } from 'vitest';
import { hasStrongNonInvoiceHeading, isObviouslyNonInvoiceFilename } from './nonInvoiceSuppression';

describe('non-invoice filename suppression', () => {
  it('suppresses obvious shipment/supporting documents', () => {
    expect(isObviouslyNonInvoiceFilename('PT BSN_Packing List_123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('carrier_AWB_123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('Haglofs_Care Label.pdf')).toBe(true);
  });

  it('does not suppress invoice document types that can be payable invoices', () => {
    expect(isObviouslyNonInvoiceFilename('Commercial Invoice CI-123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('FAKTUR PAJAK E832798169.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('Tech Pack SS27.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('Trim Receipt PO-123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('Invoice INV-123.pdf')).toBe(false);
    expect(isObviouslyNonInvoiceFilename('Debit Note UJDB26-921.pdf')).toBe(false);
  });

  it('recognizes a packing-list title even when the page contains an invoice reference', () => {
    expect(hasStrongNonInvoiceHeading('ACME TEXTILES\nPACKING LIST\nInvoice No: INV-123\nQty: 10')).toBe(true);
  });

  it('blocks excluded commercial invoices while keeping an invoice that references a packing list eligible', () => {
    expect(hasStrongNonInvoiceHeading('COMMERCIAL INVOICE\nInvoice No: INV-123\nPacking List No: PL-456')).toBe(true);
    expect(hasStrongNonInvoiceHeading('Invoice No: INV-123\nPacking List No: PL-456')).toBe(false);
    expect(hasStrongNonInvoiceHeading('FAKTUR PAJAK\nKode dan Nomor Seri Faktur Pajak')).toBe(true);
  });
});
