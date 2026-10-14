import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from './auditLogService';

const DISPOSABLE_STATUSES = new Set(['CANCELLED', 'REJECTED', 'PAID']);

function assertClosedStatus(status: string) {
  if (!DISPOSABLE_STATUSES.has(String(status || '').toUpperCase())) {
    throw new AppError('Only closed, rejected, cancelled, or paid records can enter controlled disposal.', 400);
  }
}

async function getDisposition(invoiceId: string): Promise<any | null> {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "APInvoice_RetentionDisposition" WHERE invoice_id=$1 LIMIT 1`, invoiceId);
  return rows[0] || null;
}

async function upsertDisposition(input: { invoiceId: string; retentionUntil?: Date | null; legalHold?: boolean; status?: string; backupVerifiedAt?: Date | null; backupReference?: string | null; backupHash?: string | null; eligibleAt?: Date | null; reason?: string | null; metadata?: Record<string, unknown> }) {
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null;
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "APInvoice_RetentionDisposition" (id, invoice_id, retention_until, legal_hold, status, backup_verified_at, backup_reference, backup_hash, eligible_at, disposition_reason, metadata, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), NOW())
     ON CONFLICT (invoice_id) DO UPDATE SET retention_until=COALESCE(EXCLUDED.retention_until, "APInvoice_RetentionDisposition".retention_until), legal_hold=EXCLUDED.legal_hold, status=EXCLUDED.status, backup_verified_at=COALESCE(EXCLUDED.backup_verified_at, "APInvoice_RetentionDisposition".backup_verified_at), backup_reference=COALESCE(EXCLUDED.backup_reference, "APInvoice_RetentionDisposition".backup_reference), backup_hash=COALESCE(EXCLUDED.backup_hash, "APInvoice_RetentionDisposition".backup_hash), eligible_at=COALESCE(EXCLUDED.eligible_at, "APInvoice_RetentionDisposition".eligible_at), disposition_reason=EXCLUDED.disposition_reason, metadata=COALESCE(EXCLUDED.metadata, "APInvoice_RetentionDisposition".metadata), updated_at=NOW()
     RETURNING *`,
    input.invoiceId, input.retentionUntil || null, Boolean(input.legalHold), input.status || 'ACTIVE', input.backupVerifiedAt || null, input.backupReference || null, input.backupHash || null, input.eligibleAt || null, input.reason || null, metadata,
  );
  return rows[0];
}

/** Synchronise retention metadata without deleting any document. */
export async function runRetentionComplianceJob(limit = 500) {
  const safeLimit = Math.min(2000, Math.max(1, limit));
  const now = new Date();
  const invoices = await prisma.$queryRawUnsafe<any[]>(`SELECT id, invoice_number, status, retention_until, legal_hold FROM "APInvoice_Invoice" WHERE retention_until IS NOT NULL ORDER BY retention_until ASC LIMIT $1`, safeLimit);
  let synced = 0; let eligible = 0; let blockedByHold = 0; let blockedByStatus = 0; let backupRequired = 0;
  for (const invoice of invoices) {
    const existing = await getDisposition(invoice.id);
    const disposition = await upsertDisposition({ invoiceId: invoice.id, retentionUntil: invoice.retention_until, legalHold: invoice.legal_hold, status: existing?.status || 'ACTIVE' });
    synced += 1;
    if (disposition.status === 'DISPOSED') continue;
    if (invoice.legal_hold) { blockedByHold += 1; if (disposition.status !== 'LEGAL_HOLD') await upsertDisposition({ invoiceId: invoice.id, retentionUntil: invoice.retention_until, legalHold: true, status: 'LEGAL_HOLD', reason: disposition.disposition_reason }); continue; }
    if (!invoice.retention_until || new Date(invoice.retention_until) > now) continue;
    if (!DISPOSABLE_STATUSES.has(String(invoice.status || '').toUpperCase())) { blockedByStatus += 1; await upsertDisposition({ invoiceId: invoice.id, retentionUntil: invoice.retention_until, legalHold: false, status: 'BLOCKED_STATUS', reason: disposition.disposition_reason }); continue; }
    if (!disposition.backup_verified_at || !disposition.backup_reference || !disposition.backup_hash) { backupRequired += 1; await upsertDisposition({ invoiceId: invoice.id, retentionUntil: invoice.retention_until, legalHold: false, status: 'BACKUP_REQUIRED', reason: disposition.disposition_reason }); continue; }
    eligible += 1;
    await upsertDisposition({ invoiceId: invoice.id, retentionUntil: invoice.retention_until, legalHold: false, status: 'ELIGIBLE_FOR_DISPOSAL', eligibleAt: disposition.eligible_at || now, reason: disposition.disposition_reason });
  }
  return { scanned: invoices.length, synced, eligible, blockedByHold, blockedByStatus, backupRequired };
}

export async function attestRetentionBackup(invoiceId: string, userId: string, input: { reference: string; hash: string }) {
  if (!input.reference?.trim() || !input.hash?.trim()) throw new AppError('Backup reference and backup hash are required.', 400);
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, retention_until, legal_hold FROM "APInvoice_Invoice" WHERE id=$1 LIMIT 1`, invoiceId);
  const invoice = rows[0];
  if (!invoice) throw new AppError('Invoice not found.', 404);
  return upsertDisposition({ invoiceId, retentionUntil: invoice.retention_until, legalHold: invoice.legal_hold, status: invoice.legal_hold ? 'LEGAL_HOLD' : 'BACKUP_VERIFIED', backupVerifiedAt: new Date(), backupReference: input.reference.trim(), backupHash: input.hash.trim(), metadata: { verified_by: userId } });
}

export async function setRetentionLegalHold(invoiceId: string, userId: string, enabled: boolean, reason?: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, retention_until FROM "APInvoice_Invoice" WHERE id=$1 LIMIT 1`, invoiceId);
  const invoice = rows[0];
  if (!invoice) throw new AppError('Invoice not found.', 404);
  const record = await upsertDisposition({ invoiceId, retentionUntil: invoice.retention_until, legalHold: enabled, status: enabled ? 'LEGAL_HOLD' : 'ACTIVE', reason: reason?.trim() || null, metadata: { changed_by: userId } });
  await prisma.$executeRawUnsafe(`UPDATE "APInvoice_Invoice" SET legal_hold=$2, updated_at=NOW() WHERE id=$1`, invoiceId, enabled);
  return record;
}

export async function assertEligibleForDisposal(invoiceId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, status, retention_until, legal_hold FROM "APInvoice_Invoice" WHERE id=$1 LIMIT 1`, invoiceId);
  const invoice = rows[0];
  const disposition = await getDisposition(invoiceId);
  if (!invoice) throw new AppError('Invoice not found.', 404);
  assertClosedStatus(String(invoice.status));
  if (invoice.legal_hold || disposition?.legal_hold) throw new AppError('Invoice is under legal hold.', 400);
  if (!invoice.retention_until || new Date(invoice.retention_until) > new Date()) throw new AppError('Retention period has not expired.', 400);
  if (!disposition?.backup_verified_at || !disposition.backup_reference || !disposition.backup_hash) throw new AppError('Verified backup is required before disposal.', 400);
  return disposition;
}

/**
 * Complete the controlled-disposal workflow after an authorised retention
 * review. This deliberately marks the record as disposed instead of deleting
 * the invoice or its audit/PDF data automatically; an approved disposal
 * process can archive the retained evidence separately before any physical
 * purge is performed.
 */
export async function completeControlledDisposal(invoiceId: string, userId: string, reason: string) {
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw new AppError('A disposal reason is required.', 400);
  const disposition = await assertEligibleForDisposal(invoiceId);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `UPDATE "APInvoice_RetentionDisposition"
     SET status='DISPOSED', disposed_at=NOW(), disposed_by=$2, disposition_reason=$3,
         metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('disposed_by',$2,'disposed_reason',$3), updated_at=NOW()
     WHERE invoice_id=$1 AND status='ELIGIBLE_FOR_DISPOSAL'
     RETURNING *`,
    invoiceId, userId, trimmedReason,
  );
  if (!rows[0]) throw new AppError('Retention record is no longer eligible for disposal.', 409);
  await logAudit({
    invoice_id: invoiceId,
    performed_by: userId,
    action: 'RETENTION_DISPOSED',
    note: trimmedReason,
    metadata: { retention_disposition_id: disposition.id, controlled: true },
  });
  return rows[0];
}
