import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventCreate: vi.fn(),
  eventFindFirst: vi.fn(),
  eventFindMany: vi.fn(),
  eventCount: vi.fn(),
  reviewFindMany: vi.fn(),
  reviewUpsert: vi.fn(),
  vendorFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceCreate: vi.fn(),
  createOnce: vi.fn(),
  eventUpdate: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    emailIntakeEvent: {
      create: mocks.eventCreate,
      findFirst: mocks.eventFindFirst,
      findMany: mocks.eventFindMany,
      count: mocks.eventCount,
      update: mocks.eventUpdate,
    },
    intakeReviewRecord: { findMany: mocks.reviewFindMany, upsert: mocks.reviewUpsert },
    vendor: { findFirst: mocks.vendorFindFirst },
    invoice: { findFirst: mocks.invoiceFindFirst, create: mocks.invoiceCreate },
    notification: { findFirst: mocks.notificationFindFirst },
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: mocks.notificationCreate },
}));
vi.mock('./exactFileIntakeService', () => ({ createInvoiceOnceByFileHash: mocks.createOnce }));

import {
  alertEmailIntakeFailure,
  checkEmailPollHealth,
  getEmailIntakeMonitor,
  recordEmailIntakeEvent,
  isInvoiceReviewCandidate,
  backfillReviewInvoiceRecords,
} from './emailIntakeMonitoringService';

describe('email intake monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventCreate.mockResolvedValue({});
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.notificationCreate.mockResolvedValue({});
    mocks.reviewUpsert.mockResolvedValue({});
    mocks.vendorFindFirst.mockResolvedValue({ id: 'unknown-vendor' });
    mocks.invoiceFindFirst.mockResolvedValue(null);
    mocks.invoiceCreate.mockResolvedValue({ id: 'review-invoice' });
    mocks.createOnce.mockImplementation(async data => ({ invoice: await mocks.invoiceCreate({ data }), created: true }));
  });

  it('persists the stage and failure status', async () => {
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'FAILED', fileName: 'invoice.pdf', error: 'OCR failed' });
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stage: 'FAILED', status: 'FAILED', file_name: 'invoice.pdf' }),
    }));
  });

  it.each([
    {}, { invoice_type: 'STATEMENT' }, { document_type: 'PACKING_LIST' },
    { invoice_type: 'UNKNOWN' }, { invoice_type: 'INVOICE', suppressed_before_ocr: true },
    { invoice_type: 'INVOICE', payable_candidate: false },
    { invoice_type: 'INVOICE', document_classification: { document_type: 'STATEMENT', payable_candidate: false } },
  ])('retains non-invoice/unclassified attachments outside the invoice repository: %j', async metadata => {
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'REVIEW_REQUIRED', fileName: 'document.pdf',
      metadata: { ...metadata, storage_path: '/incoming/document.pdf' } });
    expect(mocks.reviewUpsert).toHaveBeenCalled();
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
    expect(mocks.vendorFindFirst).not.toHaveBeenCalled();
  });

  it.each(['INVOICE', 'PROFORMA', 'SALES_INVOICE'])(
    'preserves positively identified %s review candidates', type => {
      expect(isInvoiceReviewCandidate({ document_type: type })).toBe(true);
    });

  it.each(['COMMERCIAL_INVOICE', 'FAKTUR_PAJAK'])(
    'preserves %s for AI/header validation', type => {
      expect(isInvoiceReviewCandidate({ document_type: type })).toBe(true);
    });

  it('materializes an UNKNOWN classification when the extracted fields and filename prove it is invoice-like', () => {
    expect(isInvoiceReviewCandidate({
      file_name: 'Invoice - IA00512138.pdf',
      invoice_type: 'UNKNOWN',
      document_classification: { document_type: 'UNKNOWN', payable_candidate: false },
      payable_candidate: false,
      invoice_number: 'IA00512138',
      vendor_name: 'CHECKPOINT SYSTEMS LIMITED',
      invoice_date: '2026-11-09',
      currency: 'USD',
      total_amount: 5006.65,
    })).toBe(true);
  });

  it('keeps an unknown packing list out even when OCR extracted invoice-like fields', () => {
    expect(isInvoiceReviewCandidate({
      file_name: 'Packing_List_IA00512139.pdf',
      invoice_type: 'UNKNOWN',
      document_classification: { document_type: 'UNKNOWN', payable_candidate: false },
      invoice_number: 'IA00512139',
      vendor_name: 'CHECKPOINT SYSTEMS LIMITED',
      invoice_date: '2026-11-09',
      currency: 'USD',
      total_amount: 5006.65,
    })).toBe(false);
  });

  it('still materializes an actual invoice with incomplete extraction', async () => {
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'REVIEW_REQUIRED',
      metadata: { invoice_type: 'INVOICE', storage_path: '/incoming/invoice.pdf', attachment_file_hash: 'a'.repeat(64) } });
    expect(mocks.invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXCEPTION_FLAGGED', source_document_type: 'INVOICE' }),
    }));
  });

  it('materializes a strong-evidence UNKNOWN invoice as an INVOICE exception row', async () => {
    await recordEmailIntakeEvent({ source: 'POWER_AUTOMATE', stage: 'REVIEW_REQUIRED', fileName: 'Invoice - IA00512138.pdf',
      metadata: {
        invoice_type: 'UNKNOWN',
        document_classification: { document_type: 'UNKNOWN', payable_candidate: false },
        invoice_number: 'IA00512138',
        vendor_name: 'CHECKPOINT SYSTEMS LIMITED',
        invoice_date: '2026-11-09',
        currency: 'USD',
        total_amount: 5006.65,
        storage_path: '/incoming/Invoice - IA00512138.pdf',
        attachment_file_hash: 'b'.repeat(64),
      } });
    expect(mocks.invoiceCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXCEPTION_FLAGGED', source_document_type: 'INVOICE', invoice_type: 'INVOICE' }),
    }));
    const data = mocks.invoiceCreate.mock.calls.at(-1)?.[0]?.data;
    expect(data?.ocr_raw_data?.classification_fallback).toBe('STRONG_INVOICE_EVIDENCE');
    expect(data?.ocr_raw_data?.document_classification?.payable_candidate).toBe(true);
  });

  it('does not manufacture an invoice when a review PDF cannot be fingerprinted', async () => {
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'REVIEW_REQUIRED',
      metadata: { invoice_type: 'INVOICE', storage_path: '/nonexistent/review-file.pdf' } });
    expect(mocks.reviewUpsert).toHaveBeenCalled();
    expect(mocks.createOnce).not.toHaveBeenCalled();
  });

  it('reuses an existing invoice across different review intake IDs for the same PDF', async () => {
    mocks.createOnce.mockResolvedValue({ invoice: { id: 'existing-invoice' }, created: false });
    await recordEmailIntakeEvent({ source: 'GRAPH', stage: 'REVIEW_REQUIRED', messageId: 'another-message',
      metadata: { invoice_type: 'INVOICE', storage_path: '/another-copy.pdf', attachment_file_hash: 'a'.repeat(64) } });
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ invoice_id: 'existing-invoice' }) }));
  });

  it('does not recreate suppressed non-invoices through historical backfill', async () => {
    mocks.eventFindMany.mockResolvedValueOnce([{ id: 'event-1', source: 'GRAPH', intake_id: 'intake-1',
      metadata: { storage_path: '/incoming/customs.pdf', suppressed_before_ocr: true } }]);
    await expect(backfillReviewInvoiceRecords()).resolves.toEqual({ scanned: 1, materialized: 0 });
    expect(mocks.invoiceCreate).not.toHaveBeenCalled();
  });

  it('alerts IT and Purchasing when an attachment fails', async () => {
    await alertEmailIntakeFailure({ source: 'Power Automate', fileName: 'invoice.pdf', error: 'Upload failed' });
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
  });

  it('alerts when the latest successful Graph poll is stale', async () => {
    mocks.eventFindFirst.mockResolvedValue({ created_at: new Date(Date.now() - 60 * 60 * 1000) });
    await checkEmailPollHealth();
    expect(mocks.notificationCreate).toHaveBeenCalledTimes(2);
  });

  it('returns recent events and health summary', async () => {
    const now = new Date();
    mocks.eventFindMany.mockResolvedValue([{ id: 'event-1' }]);
    mocks.eventFindFirst.mockResolvedValue({ created_at: now });
    mocks.eventCount.mockResolvedValue(1);
    mocks.reviewFindMany.mockResolvedValue([]);
    await expect(getEmailIntakeMonitor(50)).resolves.toEqual({
      latest_poll_at: now,
      failures_24h: 1,
      events: [{ id: 'event-1' }],
      recovery_queue: [],
      review_records: [],
    });
  });
});
