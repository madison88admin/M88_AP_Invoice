import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma + nextGenService before importing the service.
const {
  invoiceFindUnique,
  invoiceUpdate,
  exceptionCreate,
  getFullPOByMPO,
  getNextGenMetricsMock,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  exceptionCreate: vi.fn(),
  getFullPOByMPO: vi.fn(),
  getNextGenMetricsMock: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    exception: { create: exceptionCreate },
  },
}));

vi.mock('./nextGenService', () => ({
  nextGenService: { getFullPOByMPO: getFullPOByMPO },
  getNextGenMetrics: getNextGenMetricsMock,
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { checkNextGenChanges } from './validationService';

const INVOICE = {
  id: 'inv-1',
  mpo_number: 'MPO12345',
  total_amount: '100',
  qty_shipped: 10,
  po_validation: null,
  vendor: { name: 'Vendor A' },
};

beforeEach(() => {
  vi.clearAllMocks();
  invoiceFindUnique.mockResolvedValue(INVOICE);
  getNextGenMetricsMock.mockReturnValue({
    cooldown_active: false,
    consecutive_failures: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkNextGenChanges — NextGen availability', () => {
  it('returns nextGenUnavailable when NextGen hangs past the 10s budget', async () => {
    vi.useFakeTimers();
    getFullPOByMPO.mockReturnValue(new Promise(() => {})); // never resolves

    const promise = checkNextGenChanges('inv-1');
    await vi.advanceTimersByTimeAsync(10001);
    const result = await promise;

    expect(result.nextGenUnavailable).toBe(true);
    expect(result.hasChanges).toBe(false);
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('returns nextGenUnavailable when NextGen is in cooldown (quick null)', async () => {
    getFullPOByMPO.mockResolvedValue(null);
    getNextGenMetricsMock.mockReturnValue({
      cooldown_active: true,
      consecutive_failures: 12,
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(true);
    expect(result.hasChanges).toBe(false);
  });

  it('returns nextGenUnavailable on recent consecutive failures even without cooldown', async () => {
    getFullPOByMPO.mockResolvedValue(null);
    getNextGenMetricsMock.mockReturnValue({
      cooldown_active: false,
      consecutive_failures: 3,
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(true);
  });

  it('returns nextGenUnavailable=false when PO is genuinely not found (healthy NextGen)', async () => {
    getFullPOByMPO.mockResolvedValue(null);
    getNextGenMetricsMock.mockReturnValue({
      cooldown_active: false,
      consecutive_failures: 0,
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(false);
    expect(result.hasChanges).toBe(false);
  });

  it('returns nextGenUnavailable=false and stores data on a healthy check', async () => {
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10 }],
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
      })
    );
    const updateArg = invoiceUpdate.mock.calls[0][0];
    const poValidation = JSON.parse(updateArg.data.po_validation);
    expect(poValidation.nextgen_data.po_number).toBe('PO1');
  });
});
