import prisma from '../config/database';

/**
 * Returns the supplier-list default without replacing an extracted value.
 * Vendor Master updates are controlled by the supplier-list import script.
 */
export async function getVendorPaymentTermDefault(vendorId?: string | null): Promise<string | null> {
  if (!vendorId) return null;
  try {
    const vendorClient = prisma.vendor as any;
    // Some isolated unit-test fixtures intentionally provide only the Prisma
    // methods they exercise. Treat a missing optional lookup as no default.
    if (typeof vendorClient.findUnique !== 'function') return null;
    const vendor = await vendorClient.findUnique({
      where: { id: vendorId },
      select: { default_payment_terms: true },
    });
    return vendor?.default_payment_terms?.trim() || null;
  } catch (error) {
    console.warn('[VendorDefaults] Unable to read supplier-list payment terms:', error);
    return null;
  }
}

export function preferExtractedPaymentTerms(extracted: unknown, masterDefault: unknown): string | null {
  const value = String(extracted ?? '').trim();
  if (value && !['N/A', 'NA', 'NONE', 'UNKNOWN', 'UNSPECIFIED', 'UNDEFINED', 'NULL', '-'].includes(value.toUpperCase())) {
    return value;
  }
  const fallback = String(masterDefault ?? '').trim();
  return fallback || null;
}
