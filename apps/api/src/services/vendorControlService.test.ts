import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  vendorFindUnique,
  vendorFindMany,
  vendorUpdate,
  requestCreate,
  requestFindUnique,
  requestUpdate,
  requestFindMany,
  notificationCreate,
  auditLogCreate,
  transaction,
} = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  vendorFindMany: vi.fn(),
  vendorUpdate: vi.fn(),
  requestCreate: vi.fn(),
  requestFindUnique: vi.fn(),
  requestUpdate: vi.fn(),
  requestFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(async (actions: any[]) => {
    for (const action of actions) await action;
  }),
}));

vi.mock('../config/database', () => ({
  default: {
    vendor: { findUnique: vendorFindUnique, findMany: vendorFindMany, update: vendorUpdate },
    vendorBankChangeRequest: {
      create: requestCreate,
      findUnique: requestFindUnique,
      update: requestUpdate,
      findMany: requestFindMany,
    },
    $transaction: transaction,
  },
}));

vi.mock('./inAppNotificationService', () => ({
  inAppNotificationService: { create: notificationCreate },
}));

vi.mock('./auditLogService', () => ({
  logAudit: auditLogCreate,
}));

import {
  findDuplicateVendors,
  findBankAccountReuse,
  requestVendorBankUpdate,
  approveVendorBankChange,
  rejectVendorBankChange,
} from './vendorControlService';

const VENDOR = { id: 'v-1', name: 'PT BSN TECHNOLOGIES INDONESIA', account_number: 'ACC-111', account_number_alt: [], bank_name: 'BCA', swift_code: 'CENAIDJA' };

beforeEach(() => {
  vendorFindUnique.mockReset();
  vendorFindMany.mockReset();
  vendorUpdate.mockReset();
  requestCreate.mockReset();
  requestFindUnique.mockReset();
  requestUpdate.mockReset();
  requestFindMany.mockReset();
  notificationCreate.mockReset().mockResolvedValue({});
  auditLogCreate.mockReset().mockResolvedValue({});
});

describe('findDuplicateVendors', () => {
  it('matches case/space-insensitive normalized names', async () => {
    vendorFindMany.mockResolvedValue([
      { id: 'v-1', name: 'PT BSN TECHNOLOGIES INDONESIA' },
      { id: 'v-2', name: 'Avery Dennison' },
    ]);
    const dupes = await findDuplicateVendors('  pt   bsn technologies indonesia ');
    expect(dupes.map(d => d.id)).toEqual(['v-1']);
  });

  it('respects excludeId (used on rename) and skips inactive vendors', async () => {
    // With excludeId the DB query already excludes the vendor being renamed,
    // so only OTHER vendors can come back as duplicates.
    vendorFindMany.mockResolvedValue([]);
    const dupes = await findDuplicateVendors('Avery Dennison', 'v-2');
    expect(dupes).toEqual([]);
    expect(vendorFindMany.mock.calls[0][0].where).toMatchObject({ is_active: true, id: { not: 'v-2' } });
  });
});

describe('findBankAccountReuse', () => {
  it('detects reuse via main account and alt accounts (self excluded by the query)', async () => {
    // The real query excludes the calling vendor via WHERE id != vendorId.
    vendorFindMany.mockResolvedValue([
      { id: 'v-2', name: 'Other Vendor', account_number: 'ACC-222', account_number_alt: ['ACC-111'] },
    ]);
    const reuse = await findBankAccountReuse('v-1', 'acc-111');
    expect(reuse.map(v => v.id)).toEqual(['v-2']);
    expect(vendorFindMany.mock.calls[0][0].where).toMatchObject({ is_active: true, id: { not: 'v-1' } });
  });

  it('returns empty when no fingerprint (blank account)', async () => {
    vendorFindMany.mockResolvedValue([{ id: 'v-2', name: 'Other', account_number: 'X', account_number_alt: [] }]);
    const reuse = await findBankAccountReuse('v-1', '   ');
    expect(reuse).toEqual([]);
    expect(vendorFindMany).not.toHaveBeenCalled();
  });
});

describe('requestVendorBankUpdate', () => {
  it('persists a PENDING request and notifies Accounting', async () => {
    vendorFindUnique.mockResolvedValue(VENDOR);
    requestCreate.mockResolvedValue({ id: 'req-1', status: 'PENDING' });

    const result = await requestVendorBankUpdate('v-1', { field: 'swift_code', requested_value: 'NEWSWIFT', reason: 'Bank confirmed new SWIFT' }, 'u-1', 'Pamela', 'PURCHASING_COORDINATOR');

    expect(requestCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendor_id: 'v-1',
        field: 'swift_code',
        requested_value: 'NEWSWIFT',
        requested_by: 'Pamela',
        requested_by_id: 'u-1',
        status: 'PENDING',
      }),
    }));
    expect(result.success).toBe(true);
    expect(notificationCreate).toHaveBeenCalled();
    expect(auditLogCreate).toHaveBeenCalled();
  });

  it('rejects a no-change request', async () => {
    vendorFindUnique.mockResolvedValue(VENDOR);
    await expect(
      requestVendorBankUpdate('v-1', { field: 'bank_name', requested_value: 'BCA', reason: 'same' }, 'u-1', 'Pamela')
    ).rejects.toThrow(/No change detected/);
    expect(requestCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid bank field', async () => {
    vendorFindUnique.mockResolvedValue(VENDOR);
    await expect(
      requestVendorBankUpdate('v-1', { field: 'name', requested_value: 'X', reason: 'r' }, 'u-1', 'Pamela')
    ).rejects.toThrow(/Invalid bank field/);
  });

  it('requires a reason', async () => {
    vendorFindUnique.mockResolvedValue(VENDOR);
    await expect(
      requestVendorBankUpdate('v-1', { field: 'swift_code', requested_value: 'X', reason: '   ' }, 'u-1', 'Pamela')
    ).rejects.toThrow(/reason/);
  });
});

describe('approveVendorBankChange', () => {
  it('blocks the requester from approving their own request', async () => {
    requestFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING', requested_by_id: 'u-1', vendor_id: 'v-1', field: 'swift_code', requested_value: 'X', vendor: VENDOR });
    await expect(approveVendorBankChange('req-1', 'u-1', 'Pamela')).rejects.toThrow(/cannot approve their own/);
    expect(vendorUpdate).not.toHaveBeenCalled();
  });

  it('blocks approval when the account is reused by another vendor', async () => {
    requestFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING', requested_by_id: 'u-2', vendor_id: 'v-1', field: 'account_number', requested_value: 'ACC-999', vendor: VENDOR });
    vendorFindMany.mockResolvedValue([{ id: 'v-3', name: 'Another Vendor', account_number: 'ACC-999', account_number_alt: [] }]);

    await expect(approveVendorBankChange('req-1', 'u-1', 'Earl')).rejects.toThrow(/already used by/);
    expect(vendorUpdate).not.toHaveBeenCalled();
    // Critical alert raised
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({ action: 'BANK_ACCOUNT_REUSE_ALERT' }));
  });

  it('applies the change and marks the request APPROVED', async () => {
    requestFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING', requested_by_id: 'u-2', vendor_id: 'v-1', field: 'swift_code', requested_value: 'NEWSWIFT', vendor: VENDOR });
    vendorFindMany.mockResolvedValue([]);
    vendorUpdate.mockResolvedValue({});

    const result = await approveVendorBankChange('req-1', 'u-1', 'Earl');

    expect(vendorUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'v-1' },
      data: expect.objectContaining({ swift_code: 'NEWSWIFT', bank_verified_at: expect.any(Date) }),
    }));
    expect(requestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-1' },
      data: expect.objectContaining({ status: 'APPROVED', reviewed_by: 'Earl' }),
    }));
    expect(result.success).toBe(true);
  });
});

describe('rejectVendorBankChange', () => {
  it('blocks the requester from reviewing their own request', async () => {
    requestFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING', requested_by_id: 'u-1', vendor_id: 'v-1', field: 'swift_code', requested_value: 'X', vendor: VENDOR });
    await expect(rejectVendorBankChange('req-1', 'u-1', 'Pamela')).rejects.toThrow(/cannot review their own/);
  });

  it('marks the request REJECTED', async () => {
    requestFindUnique.mockResolvedValue({ id: 'req-1', status: 'PENDING', requested_by_id: 'u-2', vendor_id: 'v-1', field: 'swift_code', requested_value: 'X', vendor: VENDOR });
    const result = await rejectVendorBankChange('req-1', 'u-1', 'Earl', 'Not approved by Finance');
    expect(requestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-1' },
      data: expect.objectContaining({ status: 'REJECTED', reviewed_by: 'Earl' }),
    }));
    expect(result.success).toBe(true);
  });
});
