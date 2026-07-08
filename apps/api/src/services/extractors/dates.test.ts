import { describe, it, expect } from 'vitest';
import {
  monthNameToNumber,
  parseDate,
  computeDueDateFromTerms,
  formatDate,
  extractInvoiceDate,
  extractDueDate,
} from './dates';

describe('monthNameToNumber', () => {
  it('converts short month names to numbers', () => {
    expect(monthNameToNumber('jan')).toBe(1);
    expect(monthNameToNumber('May')).toBe(5);
    expect(monthNameToNumber('DEC')).toBe(12);
  });

  it('defaults to 1 for unknown months', () => {
    expect(monthNameToNumber('foo')).toBe(1);
  });
});

describe('parseDate', () => {
  it('parses DD/MM/YYYY', () => {
    expect(parseDate('29/12/2025', false)).toBe('2025-12-29');
  });

  it('parses MM/DD/YYYY when preferUS is true', () => {
    expect(parseDate('12/29/2025', true)).toBe('2025-12-29');
  });

  it('parses YYYY-MM-DD', () => {
    expect(parseDate('2025-12-29')).toBe('2025-12-29');
  });

  it('parses DD-MMM-YYYY', () => {
    expect(parseDate('29-Dec-2025')).toBe('2025-12-29');
  });

  it('parses DD MMM YYYY', () => {
    expect(parseDate('19 JAN 2026')).toBe('2026-01-19');
  });

  it('parses YYMMDD', () => {
    expect(parseDate('260114')).toBe('2026-01-14');
  });

  it('parses 2-digit year formats', () => {
    expect(parseDate('28-May-26')).toBe('2026-05-28');
  });

  it('handles ambiguous dates by swapping month/day when invalid', () => {
    expect(parseDate('31/12/2025', false)).toBe('2025-12-31');
  });

  it('returns null for invalid dates', () => {
    expect(parseDate('not a date')).toBeNull();
  });

  it('rejects dates outside 2000-2100', () => {
    expect(parseDate('19/01/1999')).toBeNull();
  });
});

describe('computeDueDateFromTerms', () => {
  it('computes due date from numeric days', () => {
    expect(computeDueDateFromTerms('2026-01-01', 'NET 30 Days')).toBe('2026-01-31');
  });

  it('returns null for missing terms', () => {
    expect(computeDueDateFromTerms('2026-01-01', 'CASH')).toBeNull();
  });

  it('returns null for invalid invoice date', () => {
    expect(computeDueDateFromTerms('invalid', '30 Days')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats ISO date to YYYY-MM-DD', () => {
    expect(formatDate('2026-05-07T00:00:00Z')).toBe('2026-05-07');
  });

  it('returns null for invalid dates', () => {
    expect(formatDate('invalid')).toBeNull();
  });
});

describe('extractInvoiceDate', () => {
  it('extracts date from invoice label', () => {
    const text = 'Invoice Date: 08 May 2026\nInvoice No: 12345';
    expect(extractInvoiceDate(text)).toBe('2026-05-08');
  });

  it('falls back to DD/MM/YYYY format', () => {
    const text = 'Some header\n08/05/2026\nTotal: 100.00';
    expect(extractInvoiceDate(text)).toBe('2026-05-08');
  });

  it('returns null when no date is found', () => {
    expect(extractInvoiceDate('No dates here')).toBeNull();
  });
});

describe('extractDueDate', () => {
  it('extracts due date from label', () => {
    const text = 'Due Date: 07 Jun 2026';
    expect(extractDueDate(text)).toBe('2026-06-07');
  });

  it('extracts pay-on deadline and uses invoice year', () => {
    const text = 'Please pay on May 7';
    expect(extractDueDate(text, false, '2026-01-01')).toBe('2026-05-07');
  });

  it('returns null when no due date is found', () => {
    expect(extractDueDate('No due dates here')).toBeNull();
  });
});
