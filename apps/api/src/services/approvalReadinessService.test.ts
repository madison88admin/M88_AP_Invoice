import { describe, expect, it } from 'vitest';
import { getApprovalReadiness } from './approvalReadinessService';

const complete = () => ({ vendor_id: 'v1', invoice_number: 'INV-UAT', invoice_date: new Date(), currency: 'USD', total_amount: 20, brand: 'BRAND', season: 'SS27', due_date: new Date(), pdf_path: 'invoices/a.pdf', mpo_number: 'MPO1', invoice_lines: [{ line_number: 1, mpo_base_number: 'MPO1', material_code: 'MAT1', quantity: 2, unit_price: 10, line_amount: 20 }] });

describe('getApprovalReadiness', () => {
  it('accepts a complete PO invoice', () => expect(getApprovalReadiness(complete())).toEqual({ ready: true, missing: [], advisory: [] }));
  it('blocks missing original PDF and incomplete PO lines', () => {
    const invoice = complete(); delete (invoice as any).pdf_path; delete (invoice.invoice_lines[0] as any).material_code;
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(false);
    expect(result.missing.map(m => m.field)).toEqual(expect.arrayContaining(['original_pdf', 'invoice_lines.1.material_code']));
  });

  it('reports PO-backed invoices without line items as advisory (non-blocking) by default', () => {
    const invoice = complete();
    delete (invoice as any).invoice_lines;
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.advisory.map(m => m.field)).toContain('invoice_lines');
  });
});
