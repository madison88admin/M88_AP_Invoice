import { describe, expect, it } from 'vitest';
import { detectSupplierInvoiceType } from './supplierTemplateDetector';

describe('supplier template invoice type detection', () => {
  it('maps workbook supplier formats', () => {
    expect(detectSupplierInvoiceType('Trimco Group (Vietnam) Co., Ltd', 'INV')).toBe('PI');
    expect(detectSupplierInvoiceType('PT BSN Technologies Indonesia', 'INV')).toBe('CI');
    expect(detectSupplierInvoiceType('PT Victoria Label', 'INV')).toBe('INV');
  });

  it('preserves explicit OCR document labels', () => {
    expect(detectSupplierInvoiceType('Trimco Group', 'STATEMENT')).toBe('STATEMENT');
    expect(detectSupplierInvoiceType('Trimco Group', 'CI')).toBe('CI');
  });
});
