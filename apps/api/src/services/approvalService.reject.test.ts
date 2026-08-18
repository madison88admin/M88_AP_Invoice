import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const {
  invoiceFindUnique,
  signatureUpdate,
  signatureCreate,
  stageTimestampFindFirst,
  stageTimestampUpdate,
  stageTimestampCreate,
  invoiceUpdate,
  auditLogCreate,
  workflowActionCreate,
  workflowActionFindFirst,
  userFindUnique,
  userFindFirst,
  notifyStageTransition,
  notificationCreate,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  signatureUpdate: vi.fn(),
  signatureCreate: vi.fn(),
  stageTimestampFindFirst: vi.fn(),
  stageTimestampUpdate: vi.fn(),
  stageTimestampCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  workflowActionCreate: vi.fn(),
  workflowActionFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  notifyStageTransition: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    signature: { update: signatureUpdate, create: signatureCreate },
    stageTimestamp: { findFirst: stageTimestampFindFirst, update: stageTimestampUpdate, create: stageTimestampCreate },
    auditLog: { create: auditLogCreate },
    invoiceWorkflowAction: { create: workflowActionCreate, findFirst: workflowActionFindFirst },
    user: { findUnique: userFindUnique, findFirst: userFindFirst },
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: notificationCreate, notifyStageTransition },
}));

vi.mock('./notificationService', () => ({
  sendApprovalRequestNotification: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { rejectInvoice } from './approvalService';
import { InvoiceStatus, SignatoryRole } from '@ap-invoice/shared';

const COORD = 'sig-coord';
const MGR = 'sig-mgr';

function makeSignedInvoice() {
  return {
    id: 'inv-1',
    invoice_number: 'INV-001',
    revision: 1,
    status: InvoiceStatus.PENDING_ACCOUNTING,
    vendor: { name: 'QA Test Vendor' },
    signatures: [
      {
        id: COORD,
        signatory_role: SignatoryRole.COORDINATOR,
        signed_at: new Date('2026-08-10'),
        invalidated_at: null,
        approval_status: 'APPROVED',
        ocr_detected: false,
        invoice_revision: 1,
      },
      {
        id: MGR,
        signatory_role: SignatoryRole.PURCHASING_MANAGER,
        signed_at: new Date('2026-08-11'),
        invalidated_at: null,
        approval_status: 'APPROVED',
        ocr_detected: false,
        invoice_revision: 1,
      },
    ],
  };
}

beforeEach(() => {
  invoiceFindUnique.mockReset();
  signatureUpdate.mockReset();
  signatureCreate.mockReset().mockResolvedValue({});
  stageTimestampFindFirst.mockReset();
  stageTimestampUpdate.mockReset().mockResolvedValue({});
  stageTimestampCreate.mockReset();
  invoiceUpdate.mockReset();
  auditLogCreate.mockReset();
  workflowActionCreate.mockReset().mockResolvedValue({});
  workflowActionFindFirst.mockReset().mockResolvedValue(null);
  userFindUnique.mockReset().mockResolvedValue(null);
  userFindFirst.mockReset().mockResolvedValue(null);
  notifyStageTransition.mockReset();
  notificationCreate.mockReset();

  stageTimestampFindFirst.mockResolvedValue({
    id: 'stage-1',
    entered_at: new Date('2026-08-11'),
    sla_hours: 168,
  });
  stageTimestampCreate.mockResolvedValue({});
  auditLogCreate.mockResolvedValue({});
  workflowActionCreate.mockResolvedValue({});
  notifyStageTransition.mockResolvedValue({});
  notificationCreate.mockResolvedValue({});
});

describe('rejectInvoice from PENDING_ACCOUNTING (rejectFromAccounting)', () => {
  it('re-opens the last signed approver signature so they can re-approve', async () => {
    invoiceFindUnique.mockResolvedValue(makeSignedInvoice());

    await rejectInvoice('inv-1', 'qa-assoc', 'ACCOUNTING_ASSOCIATE', 'QA e2e: accounting rejects');

    // The manager's signature must be re-opened (signed_at cleared,
    // RECONFIRMATION_REQUIRED) so approveInvoice can find a pending signature
    // for the returned stage and enforce the original signer's re-approval.
    const reOpenCall = signatureUpdate.mock.calls.find(([args]: any) => args.where.id === MGR)!;
    expect(reOpenCall).toBeDefined();
    const data = reOpenCall[0].data;
    expect(data.signed_at).toBeNull();
    expect(data.approval_status).toBe('RECONFIRMATION_REQUIRED');
    expect(data.invalidated_at).toBeInstanceOf(Date);
    expect(String(data.invalidation_reason)).toMatch(/Re-opened after rejection by Accounting/);

    // Invoice returned to the manager stage.
    const invUpdateCall = invoiceUpdate.mock.calls.find(([args]: any) => args.where.id === 'inv-1')!;
    expect(invUpdateCall[0].data.status).toBe(InvoiceStatus.PENDING_MANAGER);
    expect(invUpdateCall[0].data.current_approver_role).toBe(SignatoryRole.PURCHASING_MANAGER);

    // A fresh stage timer for the returned stage.
    const stageCall = stageTimestampCreate.mock.calls.find(([args]: any) => args.data.invoice_id === 'inv-1')!;
    expect(stageCall[0].data.stage).toBe(InvoiceStatus.PENDING_MANAGER);
  });

  it('creates a coordinator signature when there is no signed approver so the return is actionable', async () => {
    const invoice = makeSignedInvoice();
    invoice.signatures = []; // no signed approver at all (accounting bulk-uploaded pre-approved invoice)
    invoiceFindUnique.mockResolvedValue(invoice);

    await rejectInvoice('inv-1', 'qa-assoc', 'ACCOUNTING_ASSOCIATE', 'QA e2e: no prior approver');

    // No signature to re-open, but a fresh COORDINATOR signature must be created
    // so the invoice returned to PENDING_COORDINATOR is actually approvable.
    expect(signatureUpdate).not.toHaveBeenCalled();
    const createCall = signatureCreate.mock.calls.find(([args]: any) => args.data.invoice_id === 'inv-1')!;
    expect(createCall).toBeDefined();
    expect(createCall[0].data.signatory_role).toBe(SignatoryRole.COORDINATOR);
    expect(createCall[0].data.approval_status).toBe('PENDING');
    expect(createCall[0].data.signed_at).toBeNull();
    expect(createCall[0].data.invoice_revision).toBe(1);

    const invUpdateCall = invoiceUpdate.mock.calls.find(([args]: any) => args.where.id === 'inv-1')!;
    expect(invUpdateCall[0].data.status).toBe(InvoiceStatus.PENDING_COORDINATOR);
    expect(invUpdateCall[0].data.current_approver_role).toBe(SignatoryRole.COORDINATOR);
  });

  it('assigns the fallback coordinator signature to the coordinator user so it lands in Returned to Me', async () => {
    const invoice = makeSignedInvoice();
    invoice.signatures = []; // no signed approver at all
    invoiceFindUnique.mockResolvedValue(invoice);

    // The coordinator who last acted on the invoice is preferred for assignment.
    workflowActionFindFirst.mockResolvedValue({
      performed_by: 'coord-user-1',
      performed_by_role: 'PURCHASING_COORDINATOR',
      created_at: new Date('2026-08-12'),
    });
    userFindUnique.mockResolvedValue({ id: 'coord-user-1', name: 'Sarah Jane Cariquitan', active: true });

    await rejectInvoice('inv-1', 'qa-assoc', 'ACCOUNTING_ASSOCIATE', 'QA e2e: no prior approver');

    const createCall = signatureCreate.mock.calls.find(([args]: any) => args.data.invoice_id === 'inv-1')!;
    expect(createCall).toBeDefined();
    expect(createCall[0].data.signatory_role).toBe(SignatoryRole.COORDINATOR);
    expect(createCall[0].data.signatory_user_id).toBe('coord-user-1');
    expect(createCall[0].data.signatory_name).toBe('Sarah Jane Cariquitan');
  });
});
