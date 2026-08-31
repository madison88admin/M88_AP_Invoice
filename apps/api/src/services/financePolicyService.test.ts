import { afterEach, describe, expect, it } from 'vitest';
import { getFinancePolicy, isNonPOCategory } from './financePolicyService';

afterEach(() => {
  delete process.env.FINANCE_PO_AMOUNT_TOLERANCE_PCT;
  delete process.env.FINANCE_INVOICE_ROUNDING_TOLERANCE;
  delete process.env.FINANCE_ENFORCEMENT_MODE;
  delete process.env.FINANCE_NON_PO_CATEGORIES;
});

describe('getFinancePolicy', () => {
  it('uses Finance advisory defaults', () => {
    expect(getFinancePolicy()).toMatchObject({
      poAmountTolerancePercent: 0.01,
      invoiceRoundingTolerance: 1,
      enforcementMode: 'advisory',
    });
  });

  it('accepts bounded Finance configuration', () => {
    process.env.FINANCE_PO_AMOUNT_TOLERANCE_PCT = '0.01';
    process.env.FINANCE_INVOICE_ROUNDING_TOLERANCE = '0.05';
    expect(getFinancePolicy()).toMatchObject({ poAmountTolerancePercent: 0.01, invoiceRoundingTolerance: 0.05 });
  });

  it('rejects unsafe tolerance configuration', () => {
    process.env.FINANCE_PO_AMOUNT_TOLERANCE_PCT = '0.50';
    expect(getFinancePolicy().poAmountTolerancePercent).toBe(0.01);
  });

  it('defaults to advisory enforcement and honors strict', () => {
    expect(getFinancePolicy().enforcementMode).toBe('advisory');
    process.env.FINANCE_ENFORCEMENT_MODE = 'strict';
    expect(getFinancePolicy().enforcementMode).toBe('strict');
    process.env.FINANCE_ENFORCEMENT_MODE = 'nonsense';
    expect(getFinancePolicy().enforcementMode).toBe('advisory');
  });

  it('classifies non-PO categories and honors the env override', () => {
    expect(isNonPOCategory('SAMPLE_CHARGES')).toBe(true);
    expect(isNonPOCategory('TRIMS')).toBe(false);
    process.env.FINANCE_NON_PO_CATEGORIES = 'TRIMS,YARN';
    expect(isNonPOCategory('TRIMS')).toBe(true);
    expect(isNonPOCategory('YARN')).toBe(true);
    expect(isNonPOCategory('LAB_TESTING')).toBe(false);
  });
});
