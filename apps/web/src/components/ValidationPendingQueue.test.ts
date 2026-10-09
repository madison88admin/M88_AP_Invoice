import { describe, expect, it } from 'vitest';
import { InvoiceStatus } from '@ap-invoice/shared';
import { getCoordinatorDisplayName, getValidationPendingInvoices } from './ValidationPendingQueue';

const invoice = (overrides: Record<string, any> = {}) => ({
  id: overrides.id || 'invoice-1',
  invoice_number: overrides.invoice_number || 'INV-001',
  vendor_id: 'vendor-1',
  vendor_name: overrides.vendor_name || 'Example Vendor',
  total_amount: 100,
  currency: 'USD',
  invoice_date: '2026-10-01T00:00:00.000Z',
  invoice_received_date: overrides.invoice_received_date || '2026-10-01T00:00:00.000Z',
  payment_terms: 'NET 30',
  invoice_type: 'INVOICE',
  category: 'TRIMS',
  status: overrides.status || InvoiceStatus.VALIDATION_PENDING,
  signatures: overrides.signatures || [],
  exceptions: [],
  stage_timestamps: [],
  audit_logs: overrides.audit_logs || [],
  ...overrides,
} as any);

describe('ValidationPendingQueue', () => {
  it('only includes invoices that are still waiting for validation', () => {
    const rows = getValidationPendingInvoices([
      invoice({ id: 'pending' }),
      invoice({ id: 'manager', status: 'PENDING_MANAGER' }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(['pending']);
  });

  it('searches invoice and coordinator details', () => {
    const rows = getValidationPendingInvoices([
      invoice({ signatures: [{ signatory_role: 'COORDINATOR', signatory_name: 'Sarah' }] }),
      invoice({ id: 'other', invoice_number: 'INV-002' }),
    ], 'Sarah');

    expect(rows).toHaveLength(1);
    expect(rows[0].invoice_number).toBe('INV-001');
  });

  it('does not use OCR signatures as the assigned coordinator name', () => {
    const row = invoice({
      signatures: [{ signatory_role: 'COORDINATOR', signatory_name: 'Printed Signer', ocr_detected: true }],
      audit_logs: [{ actor_role: 'PURCHASING_COORDINATOR', actor_name: 'Sarah Coordinator' }],
    });

    expect(getCoordinatorDisplayName(row)).toBe('Sarah Coordinator');
  });
});
