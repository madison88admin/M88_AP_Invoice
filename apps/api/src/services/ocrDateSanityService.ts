import prisma from '../config/database';
import { logger } from '../utils/logger';
import { UserRole } from '@ap-invoice/shared';
import { inAppNotificationService } from './inAppNotificationService';

/**
 * Scheduled OCR date-sanity consistency check.
 *
 * Scans non-cancelled invoices for an invoice_date whose year falls outside a
 * sane range (default 2010–2030, configurable). Any hit gets an
 * OCR_DATE_OUT_OF_RANGE exception (deduped per invoice) plus an in-app
 * notification to ACCOUNTING_ASSOCIATE, so corrupted OCR dates (e.g. the
 * 2001-style year bug) can never silently reach accounting again.
 *
 * Sane-range boundaries themselves are re-checked every run: if a previously
 * flagged invoice was corrected back into range, its pending exception is
 * auto-resolved with an audit entry.
 */

const MIN_YEAR = Number(process.env.OCR_DATE_MIN_YEAR || 2010);
const MAX_YEAR = Number(process.env.OCR_DATE_MAX_YEAR || 2030);

// Invoice statuses the sanity check never flags. Historically-ingested legacy
// records may predate the sane range by design (e.g. multi-year service
// billing); those are reviewed once and then cancelled or accepted.
const SKIPPED_STATUSES = ['CANCELLED', 'REJECTED'] as const;

function yearOutOfRange(date: Date | null | undefined): boolean {
  if (!date || isNaN(new Date(date).getTime())) return false;
  const year = new Date(date).getUTCFullYear();
  return year < MIN_YEAR || year > MAX_YEAR;
}

export interface DateSanityResult {
  scanned: number;
  flagged: number;
  already_flagged: number;
  auto_resolved: number;
  flagged_invoices: { invoice_id: string; invoice_number: string; invoice_date: string | null }[];
}

export async function runOcrDateSanityCheck(initiatedBy = 'scheduler'): Promise<DateSanityResult> {
  const invoices = await prisma.invoice.findMany({
    where: { status: { notIn: [...SKIPPED_STATUSES] }, invoice_date: { not: null } },
    select: { id: true, invoice_number: true, invoice_date: true },
  });

  const flaggedInvoices: DateSanityResult['flagged_invoices'] = [];
  let alreadyFlagged = 0;
  let autoResolved = 0;

  for (const invoice of invoices) {
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
    const insane = yearOutOfRange(invoiceDate);

    const pendingExceptions = await prisma.exception.findMany({
      where: { invoice_id: invoice.id, reason: 'OCR_DATE_OUT_OF_RANGE' as any, status: 'PENDING' },
      select: { id: true },
    });

    if (insane) {
      if (pendingExceptions.length > 0) { alreadyFlagged += 1; continue; } // already flagged — dedupe
      await prisma.exception.create({
        data: {
          invoice_id: invoice.id,
          reason: 'OCR_DATE_OUT_OF_RANGE' as any,
          detail: `Invoice date ${invoiceDate!.toISOString().slice(0, 10)} is outside the sane range ${MIN_YEAR}-2030. Probable OCR date corruption — verify against the source document.`,
        },
      });
      await prisma.auditLog.create({
        data: {
          invoice_id: invoice.id,
          action: 'OCR_DATE_SANITY_FLAGGED',
          performed_by: initiatedBy,
          note: `invoice_date ${invoiceDate!.toISOString().slice(0, 10)} outside sane range ${MIN_YEAR}-${MAX_YEAR}`,
        },
      });
      await inAppNotificationService.create({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        vendor_name: '',
        title: 'Invoice date outside sane range',
        message: `Invoice ${invoice.invoice_number} has invoice_date ${invoiceDate!.toISOString().slice(0, 10)} — probable OCR corruption. Verify against the source document before approval.`,
        type: 'warning',
        target_role: UserRole.ACCOUNTING_ASSOCIATE,
      });
      flaggedInvoices.push({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoiceDate!.toISOString().slice(0, 10),
      });
    } else if (pendingExceptions.length > 0) {
      // Date was corrected back into the sane range — clear the stale flags.
      await prisma.exception.updateMany({
        where: { id: { in: pendingExceptions.map((e) => e.id) } },
        data: { status: 'RESOLVED', resolution_notes: `invoice_date is now within sane range ${MIN_YEAR}-${MAX_YEAR}`, resolved_at: new Date() },
      });
      await prisma.auditLog.create({
        data: {
          invoice_id: invoice.id,
          action: 'OCR_DATE_SANITY_RESOLVED',
          performed_by: initiatedBy,
          note: 'invoice_date corrected back into sane range — stale sanity flags auto-resolved',
        },
      });
      autoResolved += 1;
    }
  }

  const result: DateSanityResult = {
    scanned: invoices.length,
    flagged: flaggedInvoices.length,
    already_flagged: alreadyFlagged,
    auto_resolved: autoResolved,
    flagged_invoices: flaggedInvoices,
  };

  if (flaggedInvoices.length > 0 || autoResolved > 0) {
    logger.warn(`[OCR Date Sanity] Scanned ${invoices.length} invoice(s): ${flaggedInvoices.length} newly flagged, ${alreadyFlagged} already flagged (deduped), ${autoResolved} auto-resolved (by ${initiatedBy})`);
  } else if (alreadyFlagged > 0) {
    logger.info(`[OCR Date Sanity] Scanned ${invoices.length} invoice(s): 0 new flags — ${alreadyFlagged} still outside sane range ${MIN_YEAR}-${MAX_YEAR} but already flagged (deduped)`);
  } else {
    logger.info(`[OCR Date Sanity] Scanned ${invoices.length} invoice(s): all dates within sane range ${MIN_YEAR}-${MAX_YEAR}`);
  }

  return result;
}
