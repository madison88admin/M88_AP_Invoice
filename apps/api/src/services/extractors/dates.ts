/**
 * Date parsing and extraction utilities for invoice text.
 */

import { DATE_CAPTURE_PATTERN } from './constants';

/**
 * Convert month name to number.
 */
export function monthNameToNumber(monthName: string): number {
  const monthMap: Record<string, number> = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
  };
  return monthMap[monthName.toLowerCase()] || 1;
}

/**
 * Parse date string in multiple formats to ISO 8601 (YYYY-MM-DD).
 */
export function parseDate(dateStr: string, preferUS: boolean = false): string | null {
  if (!dateStr) return null;

  const normalized = dateStr.trim();

  const patterns = [
    { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, preferUS },
    { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, preferUS },
    { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, preferUS: false },
    { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, preferUS: false },
    { regex: /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/, preferUS: false },
    { regex: /^(\d{1,2})\s+([A-Za-z]{3})\s*,?\s*(\d{4})$/, preferUS: false },
    { regex: /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/, preferUS: false },
    { regex: /^(\d{2})(\d{2})(\d{2})$/, preferUS: false, isYYMMDD: true },
    { regex: /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/, preferUS: false },
    { regex: /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/, preferUS: false, isYY: true },
    { regex: /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2})$/, preferUS: false, isYY: true },
    { regex: /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{2})$/, preferUS: false, isYY: true },
    { regex: /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/, preferUS: false, isMonthDayYear: true },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      let year: number, month: number, day: number;

      if ((pattern as any).isYYMMDD) {
        year = 2000 + parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else if ((pattern as any).isMonthDayYear) {
        month = monthNameToNumber(match[1]);
        day = parseInt(match[2]);
        year = parseInt(match[3]);
      } else if ((pattern as any).isYY) {
        year = 2000 + parseInt(match[3]);
        if (isNaN(parseInt(match[2]))) {
          // Text month in middle (DD-MMM-YY)
          day = parseInt(match[1]);
          month = monthNameToNumber(match[2]);
        } else if (isNaN(parseInt(match[1]))) {
          // Text month first (Month DD,YY)
          month = monthNameToNumber(match[1]);
          day = parseInt(match[2]);
        } else {
          month = parseInt(match[2]);
          day = parseInt(match[1]);
        }
      } else {
        const groups = match.slice(1);
        if (groups.length === 3) {
          if (pattern.preferUS) {
            month = parseInt(groups[0]);
            day = parseInt(groups[1]);
            year = parseInt(groups[2]);
          } else {
            if (groups[0].length === 4) {
              year = parseInt(groups[0]);
              month = parseInt(groups[1]);
              day = parseInt(groups[2]);
            } else if (isNaN(parseInt(groups[1]))) {
              day = parseInt(groups[0]);
              month = monthNameToNumber(groups[1]);
              year = parseInt(groups[2]);
            } else {
              day = parseInt(groups[0]);
              month = parseInt(groups[1]);
              year = parseInt(groups[2]);
            }
          }

          if (groups[0].length !== 4 && !isNaN(parseInt(groups[1])) && (month < 1 || month > 12 || day < 1 || day > 31)) {
            console.log('[parseDate] Ambiguous date', match[0], ': month/day out of range, trying alternate format');
            if (pattern.preferUS) {
              month = parseInt(groups[1]);
              day = parseInt(groups[0]);
            } else {
              month = parseInt(groups[0]);
              day = parseInt(groups[1]);
            }
          }
        } else {
          continue;
        }
      }

      const date = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(date.getTime()) && year >= 2000 && year <= 2100) {
        return date.toISOString().split('T')[0];
      }
    }
  }

  return null;
}

/**
 * Compute due date from invoice date and payment terms.
 */
export function computeDueDateFromTerms(invoiceDate: string, paymentTerms: string): string | null {
  const daysMatch = paymentTerms.match(/(\d+)\s*(?:DAYS?|D)/i);
  if (!daysMatch) return null;

  const days = parseInt(daysMatch[1], 10);
  if (isNaN(days) || days <= 0) return null;

  const date = new Date(invoiceDate + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Format date string to YYYY-MM-DD.
 */
export function formatDate(str: string): string | null {
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

/**
 * Extract invoice date from text.
 */
export function extractInvoiceDate(text: string, preferUS: boolean = false): string | null {
  console.log('[extractInvoiceDate] Text length:', text.length);
  console.log('[extractInvoiceDate] First 200 chars:', text.substring(0, 200));

  const labels = ['Invoice Date', 'INVOICE DATE:', 'Date:', 'Date', 'Issued Date', 'Billing Date'];

  for (const label of labels) {
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = text.match(regex);
    if (match) {
      console.log('[extractInvoiceDate] Found label', label, 'with value:', match[1]);
      const parsed = parseDate(match[1], preferUS);
      if (parsed) {
        console.log('[extractInvoiceDate] Parsed date:', parsed);
        return parsed;
      }
    }
  }

  const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/);
  if (dateMatch) {
    console.log('[extractInvoiceDate] Found DD MMM YYYY date:', dateMatch[0]);
    const parsed = parseDate(dateMatch[0], preferUS);
    if (parsed) {
      console.log('[extractInvoiceDate] Parsed fallback date:', parsed);
      return parsed;
    }
  }

  const slashDateMatch = text.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
  if (slashDateMatch) {
    console.log('[extractInvoiceDate] Found slash date:', slashDateMatch[0]);
    const parsed = parseDate(slashDateMatch[0], preferUS);
    if (parsed) {
      console.log('[extractInvoiceDate] Parsed slash date:', parsed);
      return parsed;
    }
  }

  console.log('[extractInvoiceDate] No date found');
  return null;
}

/**
 * Extract due date from text.
 */
export function extractDueDate(text: string, preferUS: boolean = false, invoiceDate?: string | null): string | null {
  console.log('[extractDueDate] Text length:', text.length);
  console.log('[extractDueDate] First 200 chars:', text.substring(0, 200));

  const labels = ['Due Date', 'INVOICE DUE', 'Invoice due date', 'Payment Due Date', 'Due by', 'Payment Due'];

  for (const label of labels) {
    const regex = new RegExp(`${label.replace('.', '\\.')}[:\\s]*(${DATE_CAPTURE_PATTERN})`, 'i');
    const match = text.match(regex);
    if (match) {
      const dateValue = match[1].trim();
      console.log('[extractDueDate] Found label', label, 'with value:', dateValue);
      const parsed = parseDate(dateValue, preferUS);
      if (parsed) {
        console.log('[extractDueDate] Parsed date:', parsed);
        return parsed;
      }
    }
  }

  const settlementPatterns = [
    new RegExp(`(?:SETTLE|PAYMENT|DUE).{0,30}(?:BEFORE|ON\s*/\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i'),
    new RegExp(`(?:PAYABLE|DUE)\s*(?:BY|ON\s*/\s*BEFORE)[\\s:]*(${DATE_CAPTURE_PATTERN})`, 'i')
  ];
  for (const pattern of settlementPatterns) {
    const match = text.match(pattern);
    if (match) {
      const dateValue = match[1].trim();
      console.log('[extractDueDate] Found settlement deadline:', dateValue);
      const parsed = parseDate(dateValue, preferUS);
      if (parsed) {
        console.log('[extractDueDate] Parsed settlement date:', parsed);
        return parsed;
      }
    }
  }

  const payOnPatterns = [
    /(?:Please\s+)?pay\s+on\s+([A-Za-z]{3,}\s+\d{1,2})/i,
    /payment\s+on\s+([A-Za-z]{3,}\s+\d{1,2})/i,
  ];
  for (const pattern of payOnPatterns) {
    const match = text.match(pattern);
    if (match) {
      const dateValue = match[1].trim();
      console.log('[extractDueDate] Found pay-on deadline:', dateValue);
      let year = new Date().getFullYear();
      if (invoiceDate) {
        const parsedInvoiceYear = new Date(invoiceDate).getFullYear();
        if (!isNaN(parsedInvoiceYear)) year = parsedInvoiceYear;
      }
      const parsed = parseDate(`${dateValue} ${year}`, preferUS);
      if (parsed) {
        console.log('[extractDueDate] Parsed pay-on date:', parsed);
        return parsed;
      }
    }
  }

  console.log('[extractDueDate] No due date found');
  return null;
}
