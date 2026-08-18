export function maskBankAccount(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  const compact = raw.replace(/\s+/g, '');
  if (compact.length <= 4) return '*'.repeat(compact.length);
  return `${'*'.repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}

export function bankAccountFingerprint(value: unknown): string {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
