import { describe, expect, it } from 'vitest';
import { BrandTier, SignatoryRole } from '@ap-invoice/shared';
import { determineApprovalRoute } from './approvalService';

describe('approval routing', () => {
  it('routes a Tier 2 invoice ($5K-$99K) to Coordinator + PM + Sr. Manager', () => {
    const route = determineApprovalRoute(7500);
    expect(route.map(step => step.role)).toEqual([
      SignatoryRole.COORDINATOR,
      SignatoryRole.PURCHASING_MANAGER,
      SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
    ]);
  });

  it('routes a Tier 3 invoice ($100K+) to Coordinator + PM + Sr. Manager + President', () => {
    const route = determineApprovalRoute(150000);
    expect(route.map(step => step.role)).toEqual([
      SignatoryRole.COORDINATOR,
      SignatoryRole.PURCHASING_MANAGER,
      SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
      SignatoryRole.PRESIDENT,
    ]);
  });

  it('does not require brand routing data for Tier 1 invoices (<$5K)', () => {
    expect(determineApprovalRoute(3000).map(step => step.role)).toEqual([
      SignatoryRole.COORDINATOR,
      SignatoryRole.PURCHASING_MANAGER,
    ]);
  });
});
