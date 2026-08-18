import { describe, expect, it } from 'vitest';
import { splitBlockingExceptions, type ValidationResult } from './validationService';
import { ExceptionReason } from '@ap-invoice/shared';

const result = (overrides: Partial<ValidationResult>): ValidationResult => ({
  passed: true,
  message: 'ok',
  ...overrides,
});

const exception = (reason: ExceptionReason) => ({ reason, detail: 'x' });

describe('splitBlockingExceptions', () => {
  it('keeps failed-result reasons blocking and advisory/warning reasons non-blocking', () => {
    const results: ValidationResult[] = [
      result({ passed: false, reason: ExceptionReason.MISSING_BANK_INFO, message: 'no bank' }),
      result({ passed: true, advisory: true, reason: ExceptionReason.MISSING_PO_REFERENCE, message: 'advisory MPO' }),
      result({ passed: true, reason: ExceptionReason.VENDOR_THRESHOLD_EXCEEDED, message: 'warning only' }),
    ];
    const newExceptions = [
      exception(ExceptionReason.MISSING_BANK_INFO),
      exception(ExceptionReason.MISSING_PO_REFERENCE),
      exception(ExceptionReason.VENDOR_THRESHOLD_EXCEEDED),
    ];
    const { blocking, advisoryOnly } = splitBlockingExceptions(newExceptions, results, new Set());

    expect(blocking.map(e => e.reason)).toEqual([ExceptionReason.MISSING_BANK_INFO]);
    expect(advisoryOnly.map(e => e.reason)).toEqual([
      ExceptionReason.MISSING_PO_REFERENCE,
      ExceptionReason.VENDOR_THRESHOLD_EXCEEDED,
    ]);
  });

  it('treats non-waivable infrastructure failures as blocking even if the result passed', () => {
    const results: ValidationResult[] = [
      result({ passed: true, code: 'NEXTGEN_UNAVAILABLE', reason: ExceptionReason.PO_NOT_FOUND, message: 'unavailable' }),
    ];
    const newExceptions = [exception(ExceptionReason.PO_NOT_FOUND)];
    const { blocking, advisoryOnly } = splitBlockingExceptions(newExceptions, results, new Set([ExceptionReason.PO_NOT_FOUND]));

    expect(blocking.map(e => e.reason)).toEqual([ExceptionReason.PO_NOT_FOUND]);
    expect(advisoryOnly).toEqual([]);
  });
});
