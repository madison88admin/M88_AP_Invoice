import { describe, expect, it } from 'vitest';
import { BrandTier, SignatoryRole } from '@ap-invoice/shared';
import { determineApprovalRoute } from './approvalService';

describe('approval routing', () => {
  it('routes a Tier 2 invoice using a manually confirmed brand tier', () => {
    const route = determineApprovalRoute(
      2500,
      'New Customer Brand',
      undefined,
      BrandTier.OTHER
    );

    expect(route.map(step => step.role)).toEqual([
      SignatoryRole.COORDINATOR,
      SignatoryRole.PURCHASING_MANAGER,
      SignatoryRole.MLO_ACCOUNT_HOLDER,
      SignatoryRole.MLO_PLANNING_MANAGER,
      SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
    ]);
  });

  it('recognizes a configured brand by name when its code is unavailable', () => {
    const route = determineApprovalRoute(2500, 'Helly Hansen');
    expect(route).toContainEqual(
      expect.objectContaining({ role: SignatoryRole.MLO_ACCOUNT_HOLDER })
    );
  });

  it('returns an actionable error only when brand and tier are both missing', () => {
    expect(() => determineApprovalRoute(2500)).toThrow(
      'Brand or a manually confirmed Brand Tier'
    );
  });

  it('does not require brand routing data for Planning Tier invoices', () => {
    expect(determineApprovalRoute(1500).map(step => step.role)).toEqual([
      SignatoryRole.COORDINATOR,
      SignatoryRole.PURCHASING_MANAGER,
    ]);
  });
});
