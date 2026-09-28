import { describe, expect, it } from 'vitest';
import { isObviouslyNonInvoiceFilename } from './nonInvoiceSuppression';

describe('non-invoice filename suppression', () => {
  it('suppresses obvious shipment/supporting documents', () => {
    expect(isObviouslyNonInvoiceFilename('PT BSN_Packing List_123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('carrier_AWB_123.pdf')).toBe(true);
    expect(isObviouslyNonInvoiceFilename('Haglofs_Care Label.pdf')).toBe(true);
  });

  it('does not suppress invoice document types that can be payable invoices', () => {
    expect(isObviouslyNonInvoiceFilename('Commercial Invoice CI-123.pdf')).toBe(false);
    expect(isObviouslyNonInvoiceFilename('Invoice INV-123.pdf')).toBe(false);
    expect(isObviouslyNonInvoiceFilename('Debit Note UJDB26-921.pdf')).toBe(false);
  });
});
