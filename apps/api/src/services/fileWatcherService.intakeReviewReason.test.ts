import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks — the watcher service touches the filesystem and database on import.
const { prismaMock, auditLogMock, emailIntakeEventMock } = vi.hoisted(() => ({
  prismaMock: {},
  auditLogMock: vi.fn(),
  emailIntakeEventMock: vi.fn(),
}));

vi.mock('../config/database', () => ({ default: prismaMock, isDbEnabled: () => true }));
vi.mock('./auditLogService', () => ({ createAuditLog: auditLogMock, logAudit: vi.fn(), resolveAuditActorNames: vi.fn() }));
vi.mock('./emailIntakeMonitoringService', () => ({ recordEmailIntakeEvent: emailIntakeEventMock, checkEmailPollHealth: vi.fn() }));
vi.mock('./duplicateDetectionService', () => ({ checkDuplicateInvoice: vi.fn(), storeInvoiceHashFromStorage: vi.fn() }));
vi.mock('./ocrDateSanityService', () => ({ runOcrDateSanityCheck: vi.fn() }));

import { intakeReviewReason } from './fileWatcherService';

describe('fileWatcherService.intakeReviewReason — body classification beats filename hints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseValidInvoice = {
    invoice_type: 'INVOICE',
    invoice_number: 'INV-123',
    invoice_date: '2026-09-28',
    total_amount: 100,
    currency: 'USD',
  };

  it('allows a valid INVOICE whose filename contains "layout" (old bug: parked 40x)', () => {
    const reason = intakeReviewReason(
      baseValidInvoice,
      'LAYOUT FOX RACING SMS F27 - PO LABEL.PDF'
    );
    // Old code returned "Document type INVOICE is not eligible..." here.
    expect(reason).toBeNull();
  });

  it('allows a valid INVOICE with "quote" or "receipt" in the filename via email intake regex terms', () => {
    expect(intakeReviewReason(baseValidInvoice, 'quote approval INV-55.pdf')).toBeNull();
    expect(intakeReviewReason(baseValidInvoice, 'receipt acknowledgment INV-56.pdf')).toBeNull();
  });

  it('allows underscored invoice filenames (INV_100.pdf)', () => {
    expect(intakeReviewReason(baseValidInvoice, 'C&T_INV_100_2026.pdf')).toBeNull();
  });

  it('still parks STATEMENT-typed documents even with invoice-like filenames', () => {
    const reason = intakeReviewReason(
      { ...baseValidInvoice, invoice_type: 'STATEMENT' },
      'invoice.pdf'
    );
    expect(reason).toMatch(/not eligible/);
  });

  it('still parks UNKNOWN-type documents with non-invoice filenames', () => {
    const reason = intakeReviewReason(
      { ...baseValidInvoice, invoice_type: 'UNKNOWN', invoice_number: undefined },
      'ATXFreightPackingList_THK-164107.pdf'
    );
    expect(reason).toMatch(/not eligible/);
  });

  it('parks documents whose filename has a hint word when type is unclassified', () => {
    const reason = intakeReviewReason(
      { ...baseValidInvoice, invoice_type: undefined, invoice_number: undefined },
      'AWB_543505.pdf'
    );
    expect(reason).toMatch(/not eligible/);
  });

  it('keeps blocking shipping documents detected from body text (independent of filename)', () => {
    const reason = intakeReviewReason(
      {
        ...baseValidInvoice,
        raw_text: 'AIR WAYBILL\nShipper: ACME\nConsignee: Madison 88',
        invoice_number: undefined,
      },
      'invoice.pdf'
    );
    expect(reason).toMatch(/shipping\/non-invoice/);
  });

  it('keeps blocking non-USD currency after the filename fix', () => {
    const reason = intakeReviewReason(
      { ...baseValidInvoice, currency: 'HKD' },
      'LAYOUT with invoice inside.pdf'
    );
    // Default policy is 'park' (backward compatible); exception/auto modes are
    // covered in currencyPolicyService.test.ts.
    expect(reason).toMatch(/Currency HKD requires manual review/);
  });

  it('keeps blocking missing invoice number / date / amount', () => {
    expect(
      intakeReviewReason({ ...baseValidInvoice, invoice_number: undefined }, 'plain.pdf')
    ).toMatch(/Invoice number could not be extracted/);
    expect(
      intakeReviewReason({ ...baseValidInvoice, invoice_date: undefined }, 'plain.pdf')
    ).toMatch(/Invoice date could not be extracted/);
    expect(
      intakeReviewReason({ ...baseValidInvoice, total_amount: 0 }, 'plain.pdf')
    ).toMatch(/A valid non-zero invoice amount/);
  });
});
