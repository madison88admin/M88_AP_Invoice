import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma + nextGenService before importing the service.
const { invoiceUpdate, getFullPOByMPO } = vi.hoisted(() => ({
  invoiceUpdate: vi.fn(),
  getFullPOByMPO: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findUnique: vi.fn(), update: invoiceUpdate },
    exception: { create: vi.fn() },
    entityAlias: { findMany: vi.fn() },
  },
}));

vi.mock('./nextGenService', () => ({
  nextGenService: { getFullPOByMPO: getFullPOByMPO },
  getNextGenMetrics: vi.fn(() => ({ cooldown_active: false, consecutive_failures: 0 })),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { autoFillMaterialFromNextGen } from './validationService';

// The real MPO015995 shape (from the live NextGen probe): the same material
// name appears on many lines; only qty/price/line-ref disambiguate.
const MPO015995_LINES = [
  { line_reference: '1', item_code: 'MAU0 with Logo', material_name: 'MAU0 with Logo', material_id: 17913, quantity: 140, unit_price: 0.025, total_amount: 3.5 },
  { line_reference: '2', item_code: 'MAU0 with Logo', material_name: 'MAU0 with Logo', material_id: 17913, quantity: 855, unit_price: 0.025, total_amount: 21.375 },
  { line_reference: '3', item_code: 'MAU0 with Logo', material_name: 'MAU0 with Logo', material_id: 17913, quantity: 550, unit_price: 0.025, total_amount: 13.75 },
  { line_reference: '4', item_code: 'MU2W (KZOZ-EU)', material_name: 'MU2W (KZOZ-EU)', material_id: 16812, quantity: 1525, unit_price: 0.033, total_amount: 50.325 },
  { line_reference: '5', item_code: 'MU2W (KZOZ-EU)', material_name: 'MU2W (KZOZ-EU)', material_id: 16812, quantity: 2445, unit_price: 0.033, total_amount: 80.685 },
  { line_reference: '6', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 965, unit_price: 0.033, total_amount: 31.845 },
  { line_reference: '7', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 100, unit_price: 0.033, total_amount: 3.3 },
  { line_reference: '8', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 22285, unit_price: 0.033, total_amount: 735.405 },
  { line_reference: '9', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 3165, unit_price: 0.033, total_amount: 104.445 },
  { line_reference: '10', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 2785, unit_price: 0.033, total_amount: 91.905 },
  { line_reference: '11', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 3930, unit_price: 0.033, total_amount: 129.69 },
  { line_reference: '12', item_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)', material_id: 16741, quantity: 1490, unit_price: 0.033, total_amount: 49.17 },
  { line_reference: '13', item_code: 'MU2W (KZOZ-EU)', material_name: 'MU2W (KZOZ-EU)', material_id: 16812, quantity: 2445, unit_price: 0.022, total_amount: 53.79 },
  { line_reference: '14', item_code: 'MU2W (KZOZ-EU)', material_name: 'MU2W (KZOZ-EU)', material_id: 16812, quantity: 1525, unit_price: 0.022, total_amount: 33.55 },
];

const BASE_INVOICE = {
  id: 'inv-autofill-1',
  mpo_number: 'MPO015995',
  total_amount: '735.405',
  qty_shipped: 22285,
  material_code: null,
  material_name: null,
  mpo_base_number: null,
  mpo_order_sequence: null,
  po_validation: null,
  vendor: { name: 'PT Avery Dennison' },
};

beforeEach(() => {
  vi.clearAllMocks();
  invoiceUpdate.mockResolvedValue({});
  getFullPOByMPO.mockResolvedValue(null);
});

describe('autoFillMaterialFromNextGen', () => {
  it('resolves the exact line when the MPO reference carries a line suffix (MPO015995-8 → line 8)', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, mpo_number: 'MPO015995-8', qty_shipped: null, total_amount: null },
      MPO015995_LINES
    );

    expect(result.filled).toBe(true);
    expect(result.line_reference).toBe('8');
    expect(result.material_name).toBe('MUA8 (KZOZ-US)');
    expect(result.material_id).toBe(16741);
    expect(result.quantity).toBe(22285);

    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    const arg = invoiceUpdate.mock.calls[0][0];
    expect(arg.where.id).toBe('inv-autofill-1');
    expect(arg.data.material_code).toBe('MUA8 (KZOZ-US)');
    expect(arg.data.material_name).toBe('MUA8 (KZOZ-US)');
    expect(arg.data.mpo_order_sequence).toBe('8');
    expect(arg.data.mpo_base_number).toBe('MPO015995');
    const pv = JSON.parse(arg.data.po_validation);
    expect(pv.auto_filled_material.line_reference).toBe('8');
    expect(pv.auto_filled_material.material_id).toBe(16741);
  });

  it('fills the only line when the MPO has a single line', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, qty_shipped: null, total_amount: null },
      [{ line_reference: '1', item_code: 'ZVT000123', material_name: 'Polybag', quantity: 500, unit_price: 0.01, total_amount: 5 }]
    );

    expect(result.filled).toBe(true);
    expect(result.material_code).toBe('ZVT000123');
    expect(result.material_name).toBe('Polybag');
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
  });

  it('disambiguates by quantity: qty 22,285 → line 8 of 7 identical MUA8 lines', async () => {
    const result = await autoFillMaterialFromNextGen(BASE_INVOICE, MPO015995_LINES);

    expect(result.filled).toBe(true);
    expect(result.line_reference).toBe('8');
    expect(result.material_name).toBe('MUA8 (KZOZ-US)');
    expect(invoiceUpdate).toHaveBeenCalledTimes(1);
    expect(invoiceUpdate.mock.calls[0][0].data.mpo_order_sequence).toBe('8');
  });

  it('disambiguates by unit price: qty 2,445 / 53.79 → unit price 0.022 → line 13 (not lines 4/5 at 0.033)', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, qty_shipped: 2445, total_amount: '53.79' },
      MPO015995_LINES
    );

    expect(result.filled).toBe(true);
    expect(result.line_reference).toBe('13');
    expect(result.material_name).toBe('MU2W (KZOZ-EU)');
  });

  it('disambiguates by line total when qty is unknown', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, qty_shipped: null, total_amount: '104.445' },
      MPO015995_LINES
    );

    expect(result.filled).toBe(true);
    expect(result.line_reference).toBe('9');
    expect(result.material_name).toBe('MUA8 (KZOZ-US)');
  });

  it('skips when the invoice already has a material (OCR never overwritten)', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, material_code: 'MUA8 (KZOZ-US)', material_name: 'MUA8 (KZOZ-US)' },
      MPO015995_LINES
    );

    expect(result.filled).toBe(false);
    expect(result.reason).toBe('already_has_material');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('does not fill when the match stays ambiguous (never writes a wrong material)', async () => {
    // Two fully identical lines: qty, price, AND total all tie → nothing can disambiguate
    const identicalLines = [
      { line_reference: '1', item_code: 'DUPE (XX)', material_name: 'DUPE (XX)', quantity: 1000, unit_price: 0.01, total_amount: 10 },
      { line_reference: '2', item_code: 'DUPE (XX)', material_name: 'DUPE (XX)', quantity: 1000, unit_price: 0.01, total_amount: 10 },
    ];
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, qty_shipped: 1000, total_amount: '10' },
      identicalLines
    );

    expect(result.filled).toBe(false);
    expect(result.reason).toBe('ambiguous');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('returns ambiguous when nothing matches and no update happens', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, qty_shipped: 777, total_amount: '999' },
      MPO015995_LINES
    );

    expect(result.filled).toBe(false);
    expect(result.reason).toBe('ambiguous');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it('does nothing without an MPO', async () => {
    const result = await autoFillMaterialFromNextGen(
      { ...BASE_INVOICE, mpo_number: null },
      MPO015995_LINES
    );

    expect(result.filled).toBe(false);
    expect(result.reason).toBe('no_mpo');
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });
});
