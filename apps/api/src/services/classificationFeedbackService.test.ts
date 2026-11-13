import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../config/database', () => ({ default: { invoice: { findMany: mocks.findMany } } }));

import { formatClassificationFeedbackPrompt, getClassificationFeedbackExamples } from './classificationFeedbackService';

describe('classification feedback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses only invoices that reached Accounting or later as same-vendor positive context', async () => {
    mocks.findMany.mockResolvedValue([
      { invoice_type: 'INVOICE', vendor_name_raw: 'Avery Dennison', ocr_raw_data: { document_type: 'SALES_INVOICE', document_type_evidence: 'Sales Invoice' } },
      { invoice_type: 'INVOICE', vendor_name_raw: 'Other Supplier', ocr_raw_data: {} },
    ]);

    const examples = await getClassificationFeedbackExamples('Avery Dennison');
    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({ decision: 'PAYABLE_INVOICE', documentType: 'SALES_INVOICE' });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: expect.arrayContaining(['PENDING_ACCOUNTING', 'PAID']) }, is_duplicate: false }), take: 100 }));
  });

  it('does not query historical examples when vendor is unknown', async () => {
    expect(await getClassificationFeedbackExamples()).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('formats reviewer decisions as supporting evidence, not overriding instructions', () => {
    const prompt = formatClassificationFeedbackPrompt([{ decision: 'PAYABLE_INVOICE', documentType: 'SALES_INVOICE', evidence: 'Sales Invoice', vendor: 'Avery' }]);
    expect(prompt).toContain('positive vendor context only');
    expect(prompt).toContain('PAYABLE_INVOICE');
    expect(prompt).toContain('conflicts, classify UNKNOWN');
  });
});
