import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Normalize OCR/imported currency values to one valid ISO-4217 code. */
export function normalizeCurrencyCode(currency?: string | null): string {
  const raw = String(currency || 'USD').trim().toUpperCase();
  const candidates = raw.match(/[A-Z]{3}/g) || [];
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf;
  const supportedCurrencies = supportedValuesOf
    ? new Set(supportedValuesOf('currency'))
    : null;
  for (const candidate of candidates) {
    if (supportedCurrencies && !supportedCurrencies.has(candidate)) continue;
    try {
      // Intl validates the code and throws RangeError for values such as
      // "USD/CAD". The first valid code is the document's primary currency.
      new Intl.NumberFormat('en-US', { style: 'currency', currency: candidate }).formatToParts(0);
      return candidate;
    } catch {
      // Continue to the next extracted token, then fall back to USD.
    }
  }
  return 'USD';
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: normalizeCurrencyCode(currency),
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}
