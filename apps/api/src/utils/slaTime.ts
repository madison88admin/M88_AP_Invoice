export function getInvoiceSLAStart(
  invoice: { invoice_received_date?: Date | string | null; created_at?: Date | string | null } | null | undefined,
  legacyFallback?: Date | string | null
): Date {
  const candidates = [
    invoice?.invoice_received_date,
    invoice?.created_at,
    legacyFallback,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}
