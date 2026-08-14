import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma + nextGenService before importing the service.
const {
  invoiceFindUnique,
  invoiceUpdate,
  exceptionCreate,
  aliasFindMany,
  getFullPOByMPO,
  getNextGenMetricsMock,
} = vi.hoisted(() => ({
  invoiceFindUnique: vi.fn(),
  invoiceUpdate: vi.fn(),
  exceptionCreate: vi.fn(),
  aliasFindMany: vi.fn(),
  getFullPOByMPO: vi.fn(),
  getNextGenMetricsMock: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    exception: { create: exceptionCreate },
    entityAlias: { findMany: aliasFindMany },
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
  aliasFindMany.mockResolvedValue([]); // no aliases configured by default
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

  it('returns nextGenUnavailable=false, stores data, and marks firstCheck on a healthy first check', async () => {
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10 }],
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(false);
    expect(result.hasChanges).toBe(false);
    // No stored baseline yet → firstCheck must be true so the UI never claims "matches"
    expect(result.firstCheck).toBe(true);
    expect(invoiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
      })
    );
    const updateArg = invoiceUpdate.mock.calls[0][0];
    const poValidation = JSON.parse(updateArg.data.po_validation);
    expect(poValidation.nextgen_data.po_number).toBe('PO1');
  });

  it('catches an amount mismatch on the FIRST check (no baseline needed)', async () => {
    invoiceFindUnique.mockResolvedValue({
      ...INVOICE,
      total_amount: '200',
    });
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10, total_amount: 100 }],
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.firstCheck).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ field: 'invoice_amount_vs_nextgen' })
    );
  });

  it('catches a vendor mismatch on the FIRST check', async () => {
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Different Vendor Ltd',
      po_number: 'PO1',
      line_items: [{ quantity: 10, total_amount: 100 }],
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.firstCheck).toBe(true);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ field: 'invoice_vendor_vs_nextgen' })
    );
  });

  it('flags brand/season/order-type differences as informational on the first check', async () => {
    invoiceFindUnique.mockResolvedValue({
      ...INVOICE,
      brand: 'Burton',
      season: 'F26',
      order_type: 'BULK',
    });
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10, total_amount: 100 }],
      brand: 'Helly Hansen',
      season: 'SS27',
      order_type: 'SAMPLE',
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.firstCheck).toBe(true);
    expect(result.changes).toContainEqual(expect.objectContaining({ field: 'brand' }));
    expect(result.changes).toContainEqual(expect.objectContaining({ field: 'season' }));
    expect(result.changes).toContainEqual(expect.objectContaining({ field: 'order_type' }));
    // Informational only — never critical, never creates an exception
    expect(result.hasCriticalChanges).toBe(false);
    // The full changes array is persisted into po_validation so the Validation
    // tab can show these differences from stored data (survives the session)
    const updateArg = invoiceUpdate.mock.calls[0][0];
    const poValidation = JSON.parse(updateArg.data.po_validation);
    expect(poValidation.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'brand' }),
        expect.objectContaining({ field: 'season' }),
        expect.objectContaining({ field: 'order_type' }),
      ])
    );
  });

  it('skips brand/season/order-type comparison when either side is blank or a placeholder', async () => {
    invoiceFindUnique.mockResolvedValue({
      ...INVOICE,
      brand: '—',
      season: '',
    });
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10, total_amount: 100 }],
      brand: 'Helly Hansen',
      season: 'SS27',
      order_type: 'SAMPLE',
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.changes.filter(c => ['brand', 'season', 'order_type'].includes(c.field))).toHaveLength(0);
  });

  it('tolerates small amount variance (5%) on the first check', async () => {
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10, total_amount: 100 }],
    });
    invoiceFindUnique.mockResolvedValue({
      ...INVOICE,
      total_amount: '104.99', // 4.99% variance — within tolerance
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.firstCheck).toBe(true);
    expect(result.hasChanges).toBe(false);
    expect(result.changes.filter(c => c.field === 'invoice_amount_vs_nextgen')).toHaveLength(0);
  });

  it('returns firstCheck=false when a baseline snapshot already exists', async () => {
    invoiceFindUnique.mockResolvedValue({
      ...INVOICE,
      po_validation: JSON.stringify({ nextgen_data: { amount: 100, vendor_name: 'Vendor A', po_number: 'PO1', line_items: [{ quantity: 10 }] } }),
    });
    getFullPOByMPO.mockResolvedValue({
      amount: 100,
      vendor_name: 'Vendor A',
      po_number: 'PO1',
      line_items: [{ quantity: 10 }],
    });

    const result = await checkNextGenChanges('inv-1');

    expect(result.nextGenUnavailable).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.firstCheck).toBe(false);
  });
});
