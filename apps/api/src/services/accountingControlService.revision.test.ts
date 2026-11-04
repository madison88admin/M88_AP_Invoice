import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reviewFindUnique, reviewUpdateMany, reviewUpdate, invoiceFindUnique, invoiceFindMany, invoiceUpdate, auditCreate, transaction, validateInvoiceMock } = vi.hoisted(() => ({
  reviewFindUnique: vi.fn(),
  reviewUpdateMany: vi.fn(),
  reviewUpdate: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceFindMany: vi.fn(),
  invoiceUpdate: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  validateInvoiceMock: vi.fn(),
}));

vi.mock('../config/database', () => ({ default: { $transaction: transaction } }));
vi.mock('./validationService', () => ({ validateInvoice: validateInvoiceMock }));

import { resolveDuplicateRevisionReview } from './accountingControlService';

const tx = {
  duplicateRevisionReview: { findUnique: reviewFindUnique, updateMany: reviewUpdateMany, update: reviewUpdate },
  invoice: { findUnique: invoiceFindUnique, findMany: invoiceFindMany, update: invoiceUpdate },
  auditLog: { create: auditCreate },
};

const original = {
  id: 'original-1', invoice_number: 'INV-100', vendor_id: 'vendor-1', revision: 1,
  status: 'PENDING_COORDINATOR', workflow_status: 'PURCHASING_REVIEW', legal_hold: false, payments: [],
};
const incoming = {
  id: 'incoming-1', invoice_number: 'INV-100', vendor_id: 'vendor-1', revision: 1,
  status: 'EXCEPTION_FLAGGED', workflow_status: 'DUPLICATE_REVIEW', legal_hold: false, payments: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((callback: (client: any) => unknown) => callback(tx));
  reviewFindUnique.mockResolvedValue({ id: 'review-1', status: 'PENDING', invoice_id: incoming.id, candidate_invoice_id: original.id });
  reviewUpdateMany.mockResolvedValue({ count: 1 });
  reviewUpdate.mockResolvedValue({ id: 'review-1', status: 'RESOLVED' });
  invoiceFindUnique.mockImplementation(({ where }: any) => Promise.resolve(where.id === incoming.id ? incoming : original));
  invoiceFindMany.mockResolvedValue([original]);
  invoiceUpdate.mockImplementation(({ where, data }: any) => Promise.resolve({ ...(where.id === incoming.id ? incoming : original), ...data }));
  auditCreate.mockResolvedValue({});
  validateInvoiceMock.mockResolvedValue({ passed: true });
});

describe('corrected/reissued invoice activation', () => {
  it('atomically supersedes the unprotected original, activates the new revision, and reruns fresh validation', async () => {
    await resolveDuplicateRevisionReview({
      reviewId: 'review-1', classification: 'CORRECTED_REVISED', reviewerId: 'coordinator-1',
      reason: 'Supplier reissued with corrected bank charge details',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(reviewUpdateMany).toHaveBeenCalledWith({ where: { id: 'review-1', status: 'PENDING' }, data: { status: 'RESOLVED' } });
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: incoming.id },
      data: expect.objectContaining({ parent_invoice_id: original.id, revision: 2, status: 'RECEIVED', is_duplicate: false }),
    }));
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: original.id },
      data: expect.objectContaining({ status: 'CANCELLED', workflow_status: 'SUPERSEDED', duplicate_review_status: 'SUPERSEDED' }),
    }));
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(validateInvoiceMock).toHaveBeenCalledWith(incoming.id, { freshRevision: true });
  });

  it('supersedes all unprotected active siblings so only the corrected revision remains active', async () => {
    const duplicateSibling = {
      ...original,
      id: 'original-duplicate-2',
      revision: 3,
      status: 'PENDING_MANAGER',
      workflow_status: 'PENDING_MANAGER',
    };
    invoiceFindMany.mockResolvedValue([original, duplicateSibling]);

    await resolveDuplicateRevisionReview({
      reviewId: 'review-1', classification: 'CORRECTED_REVISED', reviewerId: 'coordinator-1',
      reason: 'Supplier reissued with corrected bank charge details',
    });

    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: duplicateSibling.id },
      data: expect.objectContaining({ status: 'CANCELLED', workflow_status: 'SUPERSEDED', duplicate_review_status: 'SUPERSEDED' }),
    }));
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: incoming.id },
      data: expect.objectContaining({ revision: 4, status: 'RECEIVED', workflow_status: 'RECEIVED' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ invoice_id: duplicateSibling.id, action: 'INVOICE_SUPERSEDED_BY_CORRECTED_REVISION' }),
    }));
    expect(reviewUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { invoice_id: duplicateSibling.id, status: 'PENDING' },
      data: expect.objectContaining({ status: 'RESOLVED', classification: 'SUPERSEDED_BY_CORRECTED_REVISION' }),
    }));
  });

  it('does not replace an original that already has payment history', async () => {
    invoiceFindUnique.mockImplementation(({ where }: any) => Promise.resolve(
      where.id === incoming.id ? incoming : { ...original, payments: [{ id: 'payment-1', batch_id: 'batch-1' }] },
    ));

    await expect(resolveDuplicateRevisionReview({
      reviewId: 'review-1', classification: 'CORRECTED_REVISED', reviewerId: 'coordinator-1', reason: 'Reissued invoice',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(reviewUpdateMany).not.toHaveBeenCalled();
    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(validateInvoiceMock).not.toHaveBeenCalled();
  });

  it('does not activate a revision if any duplicate sibling is already protected', async () => {
    invoiceFindMany.mockResolvedValue([original, { ...original, id: 'paid-sibling', status: 'PAID', payments: [{ id: 'payment-1' }] }]);

    await expect(resolveDuplicateRevisionReview({
      reviewId: 'review-1', classification: 'CORRECTED_REVISED', reviewerId: 'coordinator-1', reason: 'Reissued invoice',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(reviewUpdateMany).not.toHaveBeenCalled();
    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(validateInvoiceMock).not.toHaveBeenCalled();
  });

  it('does not replace an approved original', async () => {
    invoiceFindUnique.mockImplementation(({ where }: any) => Promise.resolve(
      where.id === incoming.id ? incoming : { ...original, status: 'APPROVED' },
    ));

    await expect(resolveDuplicateRevisionReview({
      reviewId: 'review-1', classification: 'CORRECTED_REVISED', reviewerId: 'coordinator-1', reason: 'Reissued invoice',
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(validateInvoiceMock).not.toHaveBeenCalled();
  });
});
