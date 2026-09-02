import { beforeEach, describe, expect, it, vi } from 'vitest';

const { vendorFindMany, vendorUpdate } = vi.hoisted(() => ({
  vendorFindMany: vi.fn(),
  vendorUpdate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  isDbEnabled: () => true,
  default: {
    vendor: {
      findMany: vendorFindMany,
      update: vendorUpdate,
    },
  },
}));

import { matchOrCreateVendor, matchVendor } from './vendorMatchingService';

function vendor(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id || 'vendor-1',
    name: overrides.name || 'CHECKPOINT SYSTEMS LIMITED',
    name_aliases: overrides.name_aliases || [],
    beneficiary_name: overrides.beneficiary_name ?? 'CHECKPOINT SYSTEMS LIMITED',
    bank_name: overrides.bank_name ?? 'Bank One',
    account_number: overrides.account_number ?? '111111',
    swift_code: overrides.swift_code ?? 'BANKHKHH',
    is_active: overrides.is_active ?? true,
  };
}

beforeEach(() => {
  vendorFindMany.mockReset();
  vendorUpdate.mockReset();
});

describe('vendor matching financial controls', () => {
  it('matches a single normalized vendor record', async () => {
    vendorFindMany.mockResolvedValue([vendor()]);

    await expect(matchVendor('Checkpoint Systems Ltd.')).resolves.toMatchObject({
      vendor_id: 'vendor-1',
      match_type: 'exact',
      confidence: 1,
    });
  });

  it('does not silently choose between duplicate vendor records with conflicting bank accounts', async () => {
    vendorFindMany.mockResolvedValue([
      vendor({ id: 'vendor-a', account_number: '111111' }),
      vendor({ id: 'vendor-b', account_number: '999999' }),
    ]);

    await expect(matchVendor('CHECKPOINT SYSTEMS LIMITED')).resolves.toBeNull();
  });

  it('matches the exact PT SML legal entity before an overlapping alias on another bank record', async () => {
    vendorFindMany.mockResolvedValue([
      vendor({
        id: 'sml-indonesia',
        name: 'PT SML Indonesia',
        name_aliases: ['SML INDONESIA PRIVATE'],
        account_number: '111111',
      }),
      vendor({
        id: 'sml-private',
        name: 'PT SML INDONESIA PRIVATE',
        account_number: '222222',
      }),
      vendor({
        id: 'sml-hk',
        name: 'SML (Hongkong) Limited',
        account_number: '333333',
      }),
    ]);

    await expect(matchVendor('PT. SML INDONESIA PRIVATE')).resolves.toMatchObject({
      vendor_id: 'sml-private',
      vendor_name: 'PT SML INDONESIA PRIVATE',
      match_type: 'exact',
      confidence: 1,
    });
  });

  it('never writes beneficiary or bank master data during OCR matching', async () => {
    vendorFindMany.mockResolvedValue([
      vendor({ beneficiary_name: null, bank_name: null, account_number: null, swift_code: null }),
    ]);

    await expect(matchOrCreateVendor('CHECKPOINT SYSTEMS LIMITED')).resolves.toMatchObject({
      vendor_id: 'vendor-1',
      auto_created: false,
    });
    expect(vendorUpdate).not.toHaveBeenCalled();
  });
});
