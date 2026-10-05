import { describe, expect, it } from 'vitest';
import { getReturnedInvoicesForUser } from './approvalQueue';

const returnedInvoice = (stage: string, coordinatorApproved: boolean) => ({
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  vendor_name: 'ACG INTERNATIONAL CO., LTD',
  total_amount: 100,
  currency: 'USD',
  invoice_date: '2026-10-01',
  invoice_received_date: '2026-10-01',
  payment_terms: 'NET_30',
  invoice_type: 'INVOICE',
  category: 'TRIMS',
  status: stage === 'COORDINATOR' ? 'PENDING_COORDINATOR' : 'PENDING_MANAGER',
  current_stage: stage,
  signatures: [
    {
      id: 'coordinator-signature',
      signatory_role: 'COORDINATOR',
      signatory_name: 'Sarah',
      signatory_user_id: 'coordinator-1',
      signed_at: coordinatorApproved ? '2026-10-05T09:00:00.000Z' : undefined,
      approval_status: coordinatorApproved ? 'APPROVED' : 'RECONFIRMATION_REQUIRED',
      ocr_detected: false,
      invalidated_at: '2026-10-05T08:00:00.000Z',
      invalidation_reason: 'Correct MPO and vendor details',
    },
    {
      id: 'manager-signature',
      signatory_role: 'PURCHASING_MANAGER',
      signatory_name: 'Maricar',
      signatory_user_id: 'manager-1',
      signed_at: undefined,
      approval_status: 'RECONFIRMATION_REQUIRED',
      ocr_detected: false,
      invalidated_at: '2026-10-05T08:00:00.000Z',
      invalidation_reason: 'Correct MPO and vendor details',
    },
  ],
  exceptions: [],
  stage_timestamps: [],
  audit_logs: [{
    id: 'return-log',
    invoice_id: 'invoice-1',
    action: 'RETURNED_FOR_CORRECTION',
    performed_by: 'manager-1',
    note: 'Reason: Correct MPO and vendor details',
    created_at: '2026-10-05T08:00:00.000Z',
  }],
} as any);

describe('returned invoice routing visibility', () => {
  it('shows a manager-returned invoice only to the coordinator while it is in coordinator stage', () => {
    const invoice = returnedInvoice('COORDINATOR', false);

    expect(getReturnedInvoicesForUser([invoice], { id: 'coordinator-1', name: 'Sarah', role: 'PURCHASING_COORDINATOR' })).toHaveLength(1);
    expect(getReturnedInvoicesForUser([invoice], { id: 'manager-1', name: 'Maricar', role: 'PURCHASING_MANAGER' })).toHaveLength(0);
  });

  it('routes legacy pending-stage payloads to the exact coordinator who signed', () => {
    const invoice = returnedInvoice('COORDINATOR', false);
    invoice.current_stage = 'PENDING_COORDINATOR';

    expect(getReturnedInvoicesForUser([invoice], { id: 'coordinator-1', name: 'Sarah', role: 'PURCHASING_COORDINATOR' })).toHaveLength(1);
    expect(getReturnedInvoicesForUser([invoice], { id: 'another-coordinator', name: 'Another Coordinator', role: 'PURCHASING_COORDINATOR' })).toHaveLength(0);
  });

  it('shows the returned invoice to the manager only after coordinator approval advances the stage', () => {
    const invoice = returnedInvoice('PURCHASING_MANAGER', true);

    expect(getReturnedInvoicesForUser([invoice], { id: 'coordinator-1', name: 'Sarah', role: 'PURCHASING_COORDINATOR' })).toHaveLength(0);
    expect(getReturnedInvoicesForUser([invoice], { id: 'manager-1', name: 'Maricar', role: 'PURCHASING_MANAGER' })).toHaveLength(1);
  });
});
