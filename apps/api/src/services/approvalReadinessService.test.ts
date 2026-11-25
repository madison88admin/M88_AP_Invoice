import { describe, expect, it } from 'vitest';
import { getApprovalReadiness } from './approvalReadinessService';

const complete = () => ({ vendor_id: 'v1', invoice_number: 'INV-UAT', invoice_date: new Date(), currency: 'USD', total_amount: 20, subtotal: 20, brand: 'BRAND', season: 'SS27', due_date: new Date(), pdf_path: 'invoices/a.pdf', mpo_number: 'MPO1', invoice_lines: [{ line_number: 1, mpo_base_number: 'MPO1', material_code: 'MAT1', quantity: 2, unit_price: 10, line_amount: 20 }] });

describe('getApprovalReadiness', () => {
  it('accepts a complete PO invoice', () => expect(getApprovalReadiness(complete())).toEqual({ ready: true, missing: [], advisory: [] }));
  it('blocks missing original PDF and incomplete PO lines', () => {
    const invoice = complete(); delete (invoice as any).pdf_path; delete (invoice.invoice_lines[0] as any).material_code;
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(false);
    expect(result.missing.map(m => m.field)).toEqual(expect.arrayContaining(['original_pdf', 'invoice_lines.1.material_code']));
  });

  it('allows PO-backed invoices without a financial breakdown', () => {
    const invoice = complete();
    delete (invoice as any).invoice_lines;
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('derives a missing subtotal from the total when no non-bank charges are present', () => {
    const result = getApprovalReadiness({ ...complete(), subtotal: null });
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it.each(['Bank Admin', 'Bank Administration', 'Bank Admin Fee', 'Administrative Fee'])('treats %s as a charge line without requiring quantity or unit price', (description) => {
    const invoice = {
      ...complete(),
      subtotal: 197,
      total_amount: 197,
      invoice_lines: [
        { line_number: 1, mpo_base_number: 'MPO1', material_code: 'MAT1', quantity: 6000, unit_price: 0.027, line_amount: 162 },
        { line_number: 2, description, line_amount: 35 },
      ],
    };
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('does not classify an ordinary product description containing Admin as a charge', () => {
    const invoice = { ...complete(), invoice_lines: [
      { line_number: 1, mpo_base_number: 'MPO1', material_code: 'MAT1', quantity: 1, unit_price: 20, line_amount: 20 },
      { line_number: 2, description: 'Admin Kit', material_code: 'KIT1', line_amount: 35 },
    ] };
    const result = getApprovalReadiness(invoice);
    expect(result.ready).toBe(false);
    expect(result.missing.map(m => m.field)).toEqual(expect.arrayContaining(['invoice_lines.2.quantity', 'invoice_lines.2.unit_price']));
  });
});
