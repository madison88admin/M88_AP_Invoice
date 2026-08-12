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

/**
 * SLA start for a stage. The Purchasing Coordinator's 7-day SLA counts from
 * the moment the invoice arrived in the system (received date or record
 * creation), not from when the approval stage opened — "pag dating ng invoice
 * sa system, start na agad ang SLA." All other stages start at the stage's
 * entered_at (the fallback).
 */
export function getStageSLAStart(
  invoice: { invoice_received_date?: Date | string | null; created_at?: Date | string | null } | null | undefined,
  stage: string | null | undefined,
  fallback: Date | string | null
): Date {
  if (stage === 'PENDING_COORDINATOR') {
    return getInvoiceSLAStart(invoice, fallback);
  }
  const parsed = new Date(fallback as any);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
