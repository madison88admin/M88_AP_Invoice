import { describe, expect, it } from 'vitest';
import { InvoiceCategory } from '@ap-invoice/shared';
import { inferServiceInvoiceCategory } from './ocrService';

describe('inferServiceInvoiceCategory', () => {
  it('classifies QIMA invoices as lab testing', () => {
    expect(inferServiceInvoiceCategory({ vendor_name: 'QIMA Limited', invoice_number: 'DNHK04-260815' }))
      .toBe(InvoiceCategory.LAB_TESTING);
  });

  it('classifies common shipping invoices', () => {
    expect(inferServiceInvoiceCategory({ vendor_name: 'SF EXPRESS', description: 'Courier charges' }))
      .toBe(InvoiceCategory.SHIPPING_FREIGHT);
  });

  it('prioritizes factory audit over general testing text', () => {
    expect(inferServiceInvoiceCategory({ vendor_name: 'Intertek', description: 'Factory audit testing service' }))
      .toBe(InvoiceCategory.FACTORY_AUDIT);
  });

  it('keeps ordinary merchandise invoices in trims', () => {
    expect(inferServiceInvoiceCategory({ vendor_name: 'Label Supplier', description: 'Hang tags' }))
      .toBe(InvoiceCategory.TRIMS);
  });
});
