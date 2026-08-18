import crypto from 'crypto';
import prisma from '../config/database';

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function evidenceFingerprint(value: any): string {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Retains immutable evidence for every DB-backed validation run. */
export async function retainValidationSnapshot(input: {
  invoiceId: string;
  invoiceRevision: number;
  state: string;
  rules: any[];
  request: any;
  response?: any;
  vendorIdInvoice?: string | null;
  vendorIdSource?: string | null;
  createdBy?: string;
}) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    await tx.validationSnapshot.updateMany({
      where: { invoice_id: input.invoiceId, superseded_at: null },
      data: { superseded_at: now },
    });
    return tx.validationSnapshot.create({ data: {
      invoice_id: input.invoiceId,
      invoice_revision: input.invoiceRevision,
      validation_state: input.state,
      source_system: 'NEXTGEN',
      source_version: process.env.NEXTGEN_API_VERSION || null,
      request_fingerprint: evidenceFingerprint(input.request),
      response_fingerprint: input.response == null ? null : evidenceFingerprint(input.response),
      request_payload: input.request,
      response_payload: input.response ?? undefined,
      rule_results: input.rules,
      vendor_id_invoice: input.vendorIdInvoice || null,
      vendor_id_source: input.vendorIdSource || null,
      retrieved_at: now,
      created_by: input.createdBy,
    } });
  });
}
