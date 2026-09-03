import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, hasPermission, isWithinRoleThreshold, ROLE_TIER_THRESHOLD } from '../lib/roleAccess';

describe('Role Access', () => {
  it('ACCOUNTING_ASSOCIATE can edit bank details', () => {
    expect(ROLE_PERMISSIONS.ACCOUNTING_ASSOCIATE.canEditBankDetails).toBe(true);
  });

  it('PURCHASING_COORDINATOR cannot edit bank details', () => {
    expect(ROLE_PERMISSIONS.PURCHASING_COORDINATOR.canEditBankDetails).toBe(false);
  });

  it('ACCOUNTING_ASSOCIATE can post', () => {
    expect(ROLE_PERMISSIONS.ACCOUNTING_ASSOCIATE.canPost).toBe(true);
  });

  it('PURCHASING_COORDINATOR cannot post', () => {
    expect(ROLE_PERMISSIONS.PURCHASING_COORDINATOR.canPost).toBe(false);
  });

  it('hasPermission returns true for valid permission', () => {
    expect(hasPermission('ACCOUNTING_ASSOCIATE', 'canPost')).toBe(true);
  });

  it('hasPermission returns false for invalid permission', () => {
    expect(hasPermission('PURCHASING_COORDINATOR', 'canPost')).toBe(false);
  });

  it('isWithinRoleThreshold returns true for zero threshold', () => {
    expect(isWithinRoleThreshold('ACCOUNTING_ASSOCIATE', 50000)).toBe(true);
  });

  it('isWithinRoleThreshold filters by threshold', () => {
    expect(isWithinRoleThreshold('SR_MANAGER_GLOBAL_PRODUCTION', 3000)).toBe(false);
    expect(isWithinRoleThreshold('SR_MANAGER_GLOBAL_PRODUCTION', 10000)).toBe(true);
  });

  it('IT_ADMIN has system health access', () => {
    expect(ROLE_PERMISSIONS.IT_ADMIN.canViewSystemHealth).toBe(true);
  });

  it('SUPERADMIN can manage users', () => {
    expect(ROLE_PERMISSIONS.SUPERADMIN.canManageUsers).toBe(true);
  });

  it('ACCOUNTING_ASSOCIATE can hold invoices', () => {
    expect(ROLE_PERMISSIONS.ACCOUNTING_ASSOCIATE.canHoldInvoice).toBe(true);
  });

  it('ACCOUNTING_SUPERVISOR can hold invoices', () => {
    expect(ROLE_PERMISSIONS.ACCOUNTING_SUPERVISOR.canHoldInvoice).toBe(true);
  });

  it('PURCHASING_COORDINATOR cannot hold invoices', () => {
    expect(hasPermission('PURCHASING_COORDINATOR', 'canHoldInvoice')).toBeFalsy();
  });
});
