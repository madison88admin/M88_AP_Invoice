import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), invoiceFindUnique: vi.fn() }));
vi.mock('../config/database', () => ({ default: { correctionLog: { create: mocks.create, findMany: mocks.findMany, updateMany: mocks.updateMany, count: mocks.count }, invoice: { findUnique: mocks.invoiceFindUnique } } }));
vi.mock('./ollamaFineTuneService', () => ({ ollamaFineTuneService: { getStatus: () => ({ isRunning: true }), startFineTune: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { correctionLogService } from './correctionLogService';

describe('correction ground-truth tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps frozen-test examples out of the few-shot query', async () => {
    mocks.findMany.mockResolvedValue([]);
    await correctionLogService.findSimilarCorrections('', 'Vendor A');
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dataset_split: 'fewshot', ground_truth_status: { in: ['corrected', 'confirmed'] } }) }));
  });

  it('does not mark an unchanged correction confirmed without explicit reviewer confirmation', async () => {
    mocks.create.mockImplementation(async ({ data }) => data);
    mocks.count.mockResolvedValue(1);
    const saved = await correctionLogService.saveCorrection({ original_fields: { invoice_number: 'A-1' }, corrected_fields: { invoice_number: 'A-1' } });
    expect(saved.ground_truth_status).toBe('approved_unverified');
  });

  it('records changed fields as corrected and explicit unchanged confirmation as confirmed', async () => {
    mocks.create.mockImplementation(async ({ data }) => data);
    mocks.count.mockResolvedValue(1);
    const corrected = await correctionLogService.saveCorrection({ original_fields: { invoice_number: 'A-1' }, corrected_fields: { invoice_number: 'A-2' } });
    const confirmed = await correctionLogService.saveCorrection({ original_fields: { invoice_number: 'A-1' }, corrected_fields: { invoice_number: 'A-1' }, ground_truth_status: 'confirmed' });
    expect(corrected.ground_truth_status).toBe('corrected');
    expect(confirmed.ground_truth_status).toBe('confirmed');
  });
});
