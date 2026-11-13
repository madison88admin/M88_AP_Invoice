import prisma from '../config/database';

type Metric = { samples: number; verified: number; mismatch: number; unverifiable: number; corrected_fields: number; false_verified: number; mismatches_on_corrected_fields: number; unverifiable_corrected_fields: number };

function blank(): Metric { return { samples: 0, verified: 0, mismatch: 0, unverifiable: 0, corrected_fields: 0, false_verified: 0, mismatches_on_corrected_fields: 0, unverifiable_corrected_fields: 0 }; }
function sameValue(a: unknown, b: unknown) { return String(a ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') === String(b ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }

export async function getEvidenceShadowReport(limit = 5000) {
  const safeLimit = Math.max(1, Math.min(10_000, Number(limit) || 5000));
  const rows = await prisma.invoice.findMany({
    orderBy: { created_at: 'desc' },
    take: safeLimit,
    select: { id: true, vendor_name_raw: true, created_at: true, ocr_raw_data: true },
  });
  const ids = rows.map((row) => row.id);
  const corrections = ids.length ? await prisma.correctionLog.findMany({
    where: { invoice_id: { in: ids }, ground_truth_status: { in: ['corrected', 'confirmed'] } },
    select: { invoice_id: true, original_fields: true, corrected_fields: true, ground_truth_status: true },
    take: safeLimit * 2,
  }) : [];
  const correctionsByInvoice = new Map<string, any[]>();
  for (const correction of corrections) {
    if (!correction.invoice_id) continue;
    const list = correctionsByInvoice.get(correction.invoice_id) || [];
    list.push(correction);
    correctionsByInvoice.set(correction.invoice_id, list);
  }
  const metrics = new Map<string, { vendor: string; source_type: string; field: string; values: Metric }>();
  const ensure = (vendor: string, source: string, field: string) => {
    const key = `${vendor.toLowerCase()}|${source}|${field}`;
    if (!metrics.has(key)) metrics.set(key, { vendor, source_type: source, field, values: blank() });
    return metrics.get(key)!.values;
  };
  for (const row of rows) {
    const raw = row.ocr_raw_data && typeof row.ocr_raw_data === 'object' ? row.ocr_raw_data as Record<string, any> : {};
    const verification = raw.field_evidence_verification || raw.raw_data?.field_evidence_verification;
    if (!verification) continue;
    const vendor = row.vendor_name_raw || 'UNKNOWN';
    const source = String(raw.field_evidence_source_type || raw.raw_data?.field_evidence_source_type || 'unknown');
    const fieldCorrections = (correctionsByInvoice.get(row.id) || []).flatMap((entry) => {
      const original = entry.original_fields || {};
      const corrected = entry.corrected_fields || {};
      return ['invoice_number', 'total_amount', 'invoice_date'].filter((field) =>
        Object.prototype.hasOwnProperty.call(corrected, field)
        && Object.prototype.hasOwnProperty.call(original, field)
        && !sameValue(original[field], corrected[field])
      ).map((field) => ({ field, state: entry.ground_truth_status }));
    });
    for (const field of ['invoice_number', 'total_amount', 'invoice_date']) {
      const result = verification[field];
      if (!result) continue;
      const value = ensure(vendor, source, field);
      value.samples++;
      if (result.status === 'verified') value.verified++;
      else if (result.status === 'mismatch') value.mismatch++;
      else value.unverifiable++;
      for (const correction of fieldCorrections.filter((item) => item.field === field)) {
        value.corrected_fields++;
        if (result.status === 'verified') value.false_verified++;
        if (result.status === 'mismatch') value.mismatches_on_corrected_fields++;
        if (result.status === 'unverifiable') value.unverifiable_corrected_fields++;
      }
    }
  }
  return {
    mode: 'shadow',
    invoices_scanned: rows.length,
    correction_records: corrections.length,
    metrics: Array.from(metrics.values()).map((item) => ({ ...item, ...item.values })),
    note: 'A verified value later corrected by a reviewer is counted as false_verified. A mismatch on a corrected field is a detected correction. Unverified approval records are excluded.',
  };
}
