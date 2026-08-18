import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const {
  invoiceFindUnique,
  signatureUpdate,
  stageTimestampFindFirst,
  stageTimestampUpdate,
  stageTimestampCreate,
  invoiceUpdate,
  auditLogCreate,
  notifyStageTransition,
  sendApprovalRequestNotification,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  signatureUpdate: vi.fn(),
  stageTimestampFindFirst: vi.fn(),
  stageTimestampUpdate: vi.fn(),
  stageTimestampCreate: vi.fn(),
  invoiceUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  notifyStageTransition: vi.fn(),
  sendApprovalRequestNotification: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    signature: { update: signatureUpdate },
    stageTimestamp: { findFirst: stageTimestampFindFirst, update: stageTimestampUpdate, create: stageTimestampCreate },
    auditLog: { create: auditLogCreate },
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: vi.fn(), notifyStageTransition },
}));

vi.mock('./notificationService', () => ({
  sendApprovalRequestNotification,
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { approveInvoice } from './approvalService';
import { InvoiceStatus, SignatoryRole } from '@ap-invoice/shared';

function makeInvoice() {
  return {
    id: 'inv-1',
    invoice_number: 'INV-001',
    revision: 1,
    status: InvoiceStatus.PENDING_COORDINATOR,
    total_amount: 1500, // Tier 1 — Coordinator + Purchasing Manager
    currency: 'USD',
    invoice_date: new Date('2026-08-10'),
    invoice_received_date: new Date('2026-08-10'),
    created_at: new Date('2026-08-10'),
    brand: 'Columbia Sportswear',
    brand_code: 'CSC',
    season: 'F26',
    payment_terms: 'Net 30',
    raw_file_url: 'https://example.com/inv.pdf',
    pdf_path: null,
    vendor_id: 'vendor-1',
    vendor: { name: 'QA Test Vendor' },
    invoice_lines: [],
    signatures: [
      {
        id: 'sig-coord',
        signatory_role: SignatoryRole.COORDINATOR,
        signatory_name: '',
        signed_at: null,
        approval_status: 'PENDING',
        ocr_detected: false,
        invoice_revision: 1,
        created_at: new Date('2026-08-11T00:00:00Z'),
      },
      {
        id: 'sig-mgr',
        signatory_role: SignatoryRole.PURCHASING_MANAGER,
        signatory_name: '',
        signed_at: null,
        approval_status: 'PENDING',
        ocr_detected: false,
        invoice_revision: 1,
        created_at: new Date('2026-08-11T00:00:01Z'),
      },
    ],
  };
}

beforeEach(() => {
  invoiceFindUnique.mockReset();
  signatureUpdate.mockReset().mockResolvedValue({});
  stageTimestampFindFirst.mockReset();
  stageTimestampUpdate.mockReset().mockResolvedValue({});
  stageTimestampCreate.mockReset().mockResolvedValue({});
  invoiceUpdate.mockReset().mockResolvedValue({});
  auditLogCreate.mockReset().mockResolvedValue({});
  notifyStageTransition.mockReset().mockResolvedValue({});
  sendApprovalRequestNotification.mockReset().mockResolvedValue({});

  stageTimestampFindFirst.mockResolvedValue({
    id: 'stage-1',
    stage: InvoiceStatus.PENDING_COORDINATOR,
    entered_at: new Date('2026-08-11'),
    sla_hours: 168,
  });
});

describe('approveInvoice', () => {
  it('records the signing user id on the signature (Returned to Me matching)', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice());

    await approveInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Sarah Jane Cariquitan');

    const updateCall = signatureUpdate.mock.calls.find(([args]: any) => args.where.id === 'sig-coord')!;
    expect(updateCall).toBeDefined();
    expect(updateCall[0].data.signatory_user_id).toBe('user-1');
    expect(updateCall[0].data.signatory_name).toBe('Sarah Jane Cariquitan');
    expect(updateCall[0].data.approval_status).toBe('APPROVED');
  });

  it('advances the invoice to the next unsigned approver stage', async () => {
    invoiceFindUnique.mockResolvedValue(makeInvoice());

    await approveInvoice('inv-1', 'user-1', 'PURCHASING_COORDINATOR', 'Sarah Jane Cariquitan');

    const invUpdateCall = invoiceUpdate.mock.calls.find(([args]: any) => args.where.id === 'inv-1')!;
    expect(invUpdateCall).toBeDefined();
    expect(invUpdateCall[0].data.status).toBe(InvoiceStatus.PENDING_MANAGER);
    expect(invUpdateCall[0].data.current_approver_role).toBe(SignatoryRole.PURCHASING_MANAGER);

    // A fresh stage timer opens for the next approver.
    const stageCall = stageTimestampCreate.mock.calls.find(([args]: any) => args.data.invoice_id === 'inv-1')!;
    expect(stageCall[0].data.stage).toBe(InvoiceStatus.PENDING_MANAGER);
  });
});
