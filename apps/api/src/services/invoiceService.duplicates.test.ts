import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma client before importing the service.
const { invoiceFindMany } = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(),
}));

vi.mock('../config/database', () => ({
  default: {
    invoice: { findMany: invoiceFindMany },
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// invoiceService pulls in many transitive deps; mock the heavy ones it imports.
vi.mock('./auditLogService', () => ({ logAudit: vi.fn(), resolveAuditActorNames: vi.fn() }));
vi.mock('./vendorMatchingService', () => ({ matchVendor: vi.fn() }));
vi.mock('./fieldDecisionEngine', () => ({ fieldDecisionEngine: { decide: vi.fn() } }));
vi.mock('./inAppNotificationService', () => ({ inAppNotificationService: { create: vi.fn(), notifyStageTransition: vi.fn() } }));
vi.mock('../utils/mpoReference', () => ({ parseMPOReference: vi.fn() }));

import { getDuplicateInvoices } from './invoiceService';

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'inv-1',
    invoice_number: overrides.invoice_number ?? 'INV-1',
    invoice_type: overrides.invoice_type ?? 'INVOICE',
    status: overrides.status ?? 'PENDING_COORDINATOR',
    total_amount: overrides.total_amount ?? '100.00',
    created_at: overrides.created_at ?? new Date('2026-08-01T00:00:00Z'),
    vendor: overrides.vendor ?? { name: 'ACME' },
  };
}

describe('getDuplicateInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a group when two active invoices share a number (case-insensitive, trimmed)', async () => {
    invoiceFindMany.mockResolvedValue([
      makeRow({ id: 'a', invoice_number: 'PI169580', status: 'PENDING_MANAGER' }),
      makeRow({ id: 'b', invoice_number: ' pi169580 ', status: 'PENDING_COORDINATOR' }),
    ]);

    const result = await getDuplicateInvoices();

    expect(result).toHaveLength(1);
    expect(result[0].invoice_number).toBe('PI169580');
    expect(result[0].count).toBe(2);
    expect(result[0].invoices.map((i: any) => i.id)).toEqual(['a', 'b']);
  });

  it('does not flag a REJECTED invoice (the DB query already excludes closed records)', async () => {
    // The where clause excludes REJECTED, so the query would return only the
    // active row — a single record is never a duplicate.
    invoiceFindMany.mockResolvedValue([
      makeRow({ id: 'b', invoice_number: 'INV-9', status: 'PENDING_MANAGER' }),
    ]);

    const result = await getDuplicateInvoices();

    expect(result).toHaveLength(0);
  });

  it('returns unique numbers with a single record as empty', async () => {
    invoiceFindMany.mockResolvedValue([
      makeRow({ id: 'a', invoice_number: 'INV-1' }),
      makeRow({ id: 'b', invoice_number: 'INV-2' }),
    ]);

    const result = await getDuplicateInvoices();

    expect(result).toHaveLength(0);
  });

  it('queries only non-empty numbers and excludes REJECTED at the DB level', async () => {
    invoiceFindMany.mockResolvedValue([]);

    await getDuplicateInvoices();

    const where = invoiceFindMany.mock.calls[0][0].where;
    expect(where.invoice_number).toEqual({ not: '' });
    expect(where.status).toEqual({ not: 'REJECTED' });
  });
});
