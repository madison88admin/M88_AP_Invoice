import { describe, expect, it } from 'vitest';
import {
  collectBankEvidenceText,
  sanitizeExtractedBankDetails,
} from './ocrService';

describe('bank extraction evidence guard', () => {
  it('rejects prompt-like bank values that only appear in BILL TO text', () => {
    const extracted: any = {
      beneficiary_name: 'Madison 88 Ltd',
      bank_name: 'Standard Chartered Bank',
      bank_swift: 'SCBLHKHHXXX',
      bank_account: '447-0-092572-7',
    };

    const result = sanitizeExtractedBankDetails(
      extracted,
      'SUPPLIER INVOICE\nBILL TO: Madison 88 Ltd\nTOTAL USD 65.77',
    );

    expect(result.review_required).toBe(true);
    expect(result.rejected_fields).toEqual(['beneficiary_name', 'bank_name', 'swift_code', 'account_number']);
    expect(extracted.beneficiary_name).toBe('');
    expect(extracted.bank_name).toBe('');
    expect(extracted.bank_swift).toBe('');
    expect(extracted.bank_account).toBe('');
  });

  it('accepts bank values when they are printed in a bank/remittance section', () => {
    const extracted: any = {
      beneficiary_name: 'Avery Dennison Hong Kong B.V.',
      bank_name: 'Standard Chartered Bank',
      bank_swift: 'SCBLHKHHXXX',
      bank_account: '447-0-092572-7',
    };

    const result = sanitizeExtractedBankDetails(
      extracted,
      'BILL TO: Madison 88 Ltd\nFor wire transfer, send remittance to:\nAvery Dennison Hong Kong B.V.\nStandard Chartered Bank (Hong Kong) Limited\nSWIFT code: SCBLHKHHXXX\nA/C# 447-0-092572-7 (USD)',
    );

    expect(result.review_required).toBe(false);
    expect(result.accepted_fields).toEqual(['beneficiary_name', 'bank_name', 'swift_code', 'account_number']);
    expect(extracted.bank_account).toBe('447-0-092572-7');
  });

  it('does not treat unrelated invoice text as bank evidence', () => {
    expect(collectBankEvidenceText('BILL TO: Madison 88 Ltd\nTOTAL USD 65.77')).toBe('');
  });
});
