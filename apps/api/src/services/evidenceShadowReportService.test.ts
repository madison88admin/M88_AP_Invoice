import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoiceFindMany: vi.fn(), correctionFindMany: vi.fn() }));
vi.mock('../config/database', () => ({ default: { invoice: { findMany: mocks.invoiceFindMany }, correctionLog: { findMany: mocks.correctionFindMany } } }));

import { getEvidenceShadowReport } from './evidenceShadowReportService';

describe('evidence shadow report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('breaks down field outcomes by source/vendor and compares against corrected values', async () => {
    mocks.invoiceFindMany.mockResolvedValue([{
      id: 'i1', vendor_name_raw: 'Vendor A', created_at: new Date(),
      ocr_raw_data: { field_evidence_source_type: 'scanned_pdf', field_evidence_verification: {
        invoice_number: { status: 'verified' }, total_amount: { status: 'mismatch' }, invoice_date: { status: 'unverifiable' },
      } },
    }]);
    mocks.correctionFindMany.mockResolvedValue([{ invoice_id: 'i1', ground_truth_status: 'corrected', original_fields: { total_amount: 123 }, corrected_fields: { total_amount: 321 } }]);
    const report = await getEvidenceShadowReport();
    expect(report.mode).toBe('shadow');
    expect(report.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ vendor: 'Vendor A', source_type: 'scanned_pdf', field: 'total_amount', mismatch: 1, corrected_fields: 1, mismatches_on_corrected_fields: 1 }),
    ]));
    expect(mocks.correctionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ground_truth_status: { in: ['corrected', 'confirmed'] } }) }));
  });
});
