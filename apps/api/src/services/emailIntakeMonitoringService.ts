import { UserRole, InvoiceType, InvoiceStatus } from '@ap-invoice/shared';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { inAppNotificationService } from './inAppNotificationService';

export type EmailIntakeStage =
  | 'POLL_SUCCESS'
  | 'POLL_FAILED'
  | 'RECEIVED'
  | 'ATTACHMENT_DETECTED'
  | 'UPLOADED'
  | 'EXTRACTED'
  | 'RETRY_ATTEMPT'
  | 'RETRY_QUEUED'
  | 'RECOVERY_REQUIRED'
  | 'REVIEW_REQUIRED'
  | 'PDF_REPLACED'
  | 'DUPLICATE'
  | 'CREATED'
  | 'SPLIT_COMPLETED'
  | 'FAILED';

type IntakeEventInput = {
  source: 'GRAPH' | 'POWER_AUTOMATE' | 'SHAREPOINT' | 'MANUAL_UPLOAD' | string;
  stage: EmailIntakeStage;
  /** REVIEW_REQUIRED is a terminal routing outcome, not a system failure. */
  status?: 'SUCCESS' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED';
  mailbox?: string;
  messageId?: string;
  attachmentId?: string;
  fileName?: string;
  invoiceId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type IntakeReviewRecordInput = {
  intakeId?: string;
  source: string;
  messageId?: string;
  attachmentId?: string;
  fileName?: string;
  storagePath?: string;
  documentType?: string;
  invoiceNumber?: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type IntakeRecoveryCaseInput = {
  intakeId: string;
  source: string;
  messageId?: string;
  attachmentId?: string;
  fileName?: string;
  storagePath?: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

/**
 * Materialize a stored REVIEW_REQUIRED attachment as a repository record.
 * Review records deliberately use EXCEPTION_FLAGGED and a review workflow
 * status, so they are searchable in Invoice Repository but cannot be posted
 * or selected for payment until a reviewer resolves them.
 */
async function createReviewInvoiceRecord(input: {
  source: string;
  intakeId: string;
  messageId?: string;
  attachmentId?: string;
  fileName?: string;
  storagePath: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<{ id: string } | null> {
  try {
    const unknownVendor = await prisma.vendor.findFirst({
      where: { name: 'UNKNOWN VENDOR' },
      select: { id: true },
    });
    if (!unknownVendor?.id) {
      logger.warn('[EmailIntakeMonitor] UNKNOWN VENDOR placeholder is missing; review row not materialized');
      return null;
    }

    const metadata = input.metadata || {};
    const identityFilters = [
      ...(input.attachmentId ? [{ source_attachment_id: input.attachmentId }] : []),
      { pdf_path: input.storagePath },
      { raw_file_url: input.storagePath },
      ...(!input.attachmentId && input.messageId ? [{ source_message_id: input.messageId }] : []),
    ];
    const existing = await prisma.invoice.findFirst({
      where: { OR: identityFilters },
      select: { id: true },
    });
    if (existing) return existing;

    const rawType = String(metadata.invoice_type || metadata.document_type || '').toUpperCase();
    const invoiceType = (Object.values(InvoiceType) as string[]).includes(rawType)
      ? rawType as InvoiceType
      : InvoiceType.INVOICE;
    const invoiceNumber = String(metadata.invoice_number || '').trim()
      || `REVIEW-${String(input.intakeId).slice(-16)}`;
    const vendorName = String(metadata.vendor_name || metadata.vendor_name_raw || '').trim()
      || 'UNKNOWN VENDOR';
    const parsedAmount = Number(metadata.amount ?? metadata.total_amount);
    const totalAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
    const currency = String(metadata.currency || 'USD').trim().toUpperCase() || 'USD';
    const lowerType = rawType.toLowerCase();
    const workflowStatus = lowerType.includes('proforma')
      ? 'PROFORMA_REVIEW'
      : ['statement', 'debit_note', 'credit_note'].some((value) => lowerType.includes(value))
        ? 'NON_PAYABLE_REVIEW'
        : 'PURCHASING_REVIEW';
    const retentionUntil = new Date();
    retentionUntil.setFullYear(retentionUntil.getFullYear() + 7);
    const extractedDate = metadata.invoice_date ? new Date(String(metadata.invoice_date)) : null;
    const invoiceDate = extractedDate && !Number.isNaN(extractedDate.getTime()) ? extractedDate : null;

    const invoice = await prisma.invoice.create({
      data: {
        invoice_number: invoiceNumber,
        vendor_id: unknownVendor.id,
        vendor_name_raw: vendorName,
        total_amount: totalAmount,
        currency,
        invoice_type: invoiceType,
        status: InvoiceStatus.EXCEPTION_FLAGGED,
        workflow_status: workflowStatus,
        source: 'EMAIL' as any,
        source_document_type: rawType || null,
        source_message_id: input.messageId || input.intakeId,
        source_attachment_id: input.attachmentId || null,
        source_received_at: new Date(),
        pdf_path: input.storagePath,
        raw_file_url: input.storagePath,
        payment_terms: typeof metadata.payment_terms === 'string' ? metadata.payment_terms : null,
        invoice_date: invoiceDate,
        mpo_number: typeof metadata.mpo_number === 'string' ? metadata.mpo_number : null,
        customer_po_number: typeof metadata.customer_po_number === 'string' ? metadata.customer_po_number : null,
        ocr_confidence_score: Number.isFinite(Number(metadata.confidence)) ? Number(metadata.confidence) : null,
        ocr_raw_data: {
          review_required: true,
          intake_id: input.intakeId,
          reason: input.reason,
          ...(metadata as any),
        },
        retention_until: retentionUntil,
      } as any,
    });
    return { id: invoice.id };
  } catch (error) {
    logger.error('[EmailIntakeMonitor] Failed to materialize review invoice:', error);
    return null;
  }
}

/** Backfill historical terminal review events that already have a PDF path. */
export async function backfillReviewInvoiceRecords(limit = 500): Promise<{ scanned: number; materialized: number }> {
  const events = await prisma.emailIntakeEvent.findMany({
    where: { stage: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', invoice_id: null },
    orderBy: { created_at: 'asc' },
    take: Math.max(1, Math.min(limit, 2000)),
  });
  let materialized = 0;
  for (const event of events) {
    const metadata = (event.metadata && typeof event.metadata === 'object' ? event.metadata : {}) as Record<string, unknown>;
    const storagePath = typeof metadata.storage_path === 'string' ? metadata.storage_path : undefined;
    if (!storagePath) continue;
    const reviewInvoice = await createReviewInvoiceRecord({
      source: event.source,
      intakeId: event.intake_id || event.message_id || event.id,
      messageId: event.message_id || undefined,
      attachmentId: event.attachment_id || undefined,
      fileName: event.file_name || undefined,
      storagePath,
      reason: event.error || 'Manual review required',
      metadata,
    });
    if (reviewInvoice?.id) {
      await prisma.emailIntakeEvent.update({
        where: { id: event.id },
        data: { invoice_id: reviewInvoice.id, metadata: { ...metadata, review_invoice_id: reviewInvoice.id, review_record: true } as any },
      });
      materialized += 1;
    }
  }
  return { scanned: events.length, materialized };
}

export async function recordIntakeRecoveryCase(input: IntakeRecoveryCaseInput): Promise<void> {
  try {
    const metadataJson = JSON.stringify(input.metadata || {});
    await prisma.$executeRawUnsafe(
      `INSERT INTO "APInvoice_IntakeRecoveryCase" (id, intake_id, source, message_id, attachment_id, file_name, storage_path, status, reason, last_error, metadata, created_at, updated_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, 'SOURCE_RECOVERY_REQUIRED', $7, $7, $8::jsonb, NOW(), NOW())
       ON CONFLICT (intake_id) DO UPDATE SET source=EXCLUDED.source, message_id=EXCLUDED.message_id, attachment_id=EXCLUDED.attachment_id, file_name=EXCLUDED.file_name, storage_path=EXCLUDED.storage_path, status='SOURCE_RECOVERY_REQUIRED', reason=EXCLUDED.reason, last_error=EXCLUDED.last_error, metadata=EXCLUDED.metadata, updated_at=NOW()`,
      input.intakeId,
      input.source,
      input.messageId || null,
      input.attachmentId || null,
      input.fileName || '',
      input.storagePath || null,
      input.reason.slice(0, 2000),
      metadataJson,
    );
  } catch (error) {
    logger.error('[EmailIntakeMonitor] Failed to persist recovery case:', error);
  }
}

/**
 * Persist a searchable review record even when the attachment is deliberately
 * not converted into a payable Invoice row (for example a pro-forma, debit
 * note, statement, or an incomplete OCR result).
 */
export async function recordIntakeReviewRecord(input: IntakeReviewRecordInput): Promise<void> {
  try {
    const reviewModel = (prisma as any).intakeReviewRecord;
    if (!reviewModel?.upsert) return;
    const intakeId = input.intakeId || input.messageId || input.attachmentId || `manual-${Date.now()}`;
    const fileName = input.fileName || '';
    await reviewModel.upsert({
      where: { intake_id_file_name: { intake_id: intakeId, file_name: fileName } },
      create: {
        intake_id: intakeId,
        source: input.source,
        message_id: input.messageId || null,
        attachment_id: input.attachmentId || null,
        file_name: fileName,
        storage_path: input.storagePath || null,
        document_type: input.documentType || null,
        invoice_number: input.invoiceNumber || null,
        reason: input.reason.slice(0, 2000),
        status: 'OPEN',
        metadata: input.metadata as any,
      },
      update: {
        source: input.source,
        message_id: input.messageId || null,
        attachment_id: input.attachmentId || null,
        storage_path: input.storagePath || null,
        document_type: input.documentType || null,
        invoice_number: input.invoiceNumber || null,
        reason: input.reason.slice(0, 2000),
        metadata: input.metadata as any,
        status: 'OPEN',
        reviewed_by: null,
        reviewed_at: null,
      },
    });
  } catch (error) {
    // Review persistence is best-effort and must never block intake.
    logger.error('[EmailIntakeMonitor] Failed to persist review record:', error);
  }
}

export async function recordEmailIntakeEvent(input: IntakeEventInput): Promise<void> {
  try {
    const event = await prisma.emailIntakeEvent.create({
      data: {
        source: input.source,
        intake_id: typeof input.metadata?.intake_id === 'string'
          ? input.metadata.intake_id
          : input.messageId,
        stage: input.stage,
        status: input.status || (
          input.stage === 'FAILED' || input.stage === 'POLL_FAILED'
            ? 'FAILED'
            : input.stage === 'REVIEW_REQUIRED'
              ? 'REVIEW_REQUIRED'
              : 'SUCCESS'
        ),
        mailbox: input.mailbox,
        message_id: input.messageId,
        attachment_id: input.attachmentId,
        file_name: input.fileName,
        invoice_id: input.invoiceId,
        error: input.error?.slice(0, 2000),
        metadata: input.metadata as any,
      } as any,
    });
    if (input.stage === 'REVIEW_REQUIRED') {
      await recordIntakeReviewRecord({
        intakeId: typeof input.metadata?.intake_id === 'string' ? input.metadata.intake_id : input.messageId,
        source: input.source,
        messageId: input.messageId,
        attachmentId: input.attachmentId,
        fileName: input.fileName,
        storagePath: typeof input.metadata?.storage_path === 'string' ? input.metadata.storage_path : undefined,
        documentType: typeof input.metadata?.invoice_type === 'string'
          ? input.metadata.invoice_type
          : typeof input.metadata?.document_type === 'string' ? input.metadata.document_type : undefined,
        invoiceNumber: typeof input.metadata?.invoice_number === 'string' ? input.metadata.invoice_number : undefined,
        reason: input.error || 'Manual review required',
        metadata: input.metadata,
      });

      // A stored PDF must never be visible only in Finance Controls. Create a
      // repository review row as well, but do not create a second row when a
      // normal invoice/duplicate path supplied invoiceId explicitly.
      const storagePath = typeof input.metadata?.storage_path === 'string'
        ? input.metadata.storage_path
        : undefined;
      if (!input.invoiceId && storagePath) {
        const reviewInvoice = await createReviewInvoiceRecord({
          source: input.source,
          intakeId: typeof input.metadata?.intake_id === 'string' ? input.metadata.intake_id : (input.messageId || `review-${event.id}`),
          messageId: input.messageId,
          attachmentId: input.attachmentId,
          fileName: input.fileName,
          storagePath,
          reason: input.error || 'Manual review required',
          metadata: input.metadata,
        });
        if (reviewInvoice?.id) {
          await prisma.emailIntakeEvent.update({
            where: { id: event.id },
            data: {
              invoice_id: reviewInvoice.id,
              metadata: { ...(input.metadata || {}), review_invoice_id: reviewInvoice.id, review_record: true } as any,
            } as any,
          });
        }
      }
    }
  } catch (error) {
    // Monitoring must never block invoice intake.
    logger.error('[EmailIntakeMonitor] Failed to persist event:', error);
  }
}

async function sendOperationalAlert(title: string, message: string): Promise<void> {
  try {
    const recent = await prisma.notification.findFirst({
      where: {
        title,
        category: 'upload',
        created_at: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent) return;

    await Promise.all([
      inAppNotificationService.create({ title, message, type: 'error', category: 'upload', target_role: UserRole.IT_ADMIN }),
      inAppNotificationService.create({ title, message, type: 'error', category: 'upload', target_role: UserRole.PURCHASING_MANAGER }),
    ]);
  } catch (error) {
    // Alert persistence is best-effort and must not stop invoice intake.
    logger.error('[EmailIntakeMonitor] Failed to create operational alert:', error);
  }
}

export async function alertEmailIntakeFailure(input: { source: string; fileName?: string; error: string }): Promise<void> {
  await sendOperationalAlert(
    'Invoice intake failed',
    `${input.source}${input.fileName ? ` · ${input.fileName}` : ''}: ${input.error}`,
  );
}

export async function checkEmailPollHealth(): Promise<void> {
  const thresholdMinutes = Math.max(10, Number(process.env.EMAIL_POLLER_ALERT_AFTER_MINUTES || 15));
  const latestSuccess = await prisma.emailIntakeEvent.findFirst({
    where: { source: 'GRAPH', stage: 'POLL_SUCCESS', status: 'SUCCESS' },
    orderBy: { created_at: 'desc' },
  });
  if (!latestSuccess || latestSuccess.created_at < new Date(Date.now() - thresholdMinutes * 60 * 1000)) {
    await sendOperationalAlert(
      'Mailbox polling delayed',
      `No successful Microsoft Graph mailbox poll has been recorded within ${thresholdMinutes} minutes. Power Automate remains primary, but the backup intake requires attention.`,
    );
  }
}

export async function getEmailIntakeMonitor(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, limit));
  const [events, latestPoll, failures24h, reviewRecords] = await Promise.all([
    prisma.emailIntakeEvent.findMany({ orderBy: { created_at: 'desc' }, take: safeLimit }),
    prisma.emailIntakeEvent.findFirst({ where: { source: 'GRAPH', stage: 'POLL_SUCCESS' }, orderBy: { created_at: 'desc' } }),
    prisma.emailIntakeEvent.count({ where: { status: 'FAILED', created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    (prisma as any).intakeReviewRecord?.findMany
      ? (prisma as any).intakeReviewRecord.findMany({ where: { status: 'OPEN' }, orderBy: { created_at: 'desc' }, take: safeLimit })
      : Promise.resolve([]),
  ]);
  const terminalStages = new Set(['CREATED', 'REVIEW_REQUIRED', 'PDF_REPLACED', 'DUPLICATE', 'SPLIT_COMPLETED']);
  const terminalIntakes = new Set(events.filter((event: any) => terminalStages.has(event.stage)).map((event: any) => event.intake_id || event.message_id));
  const recovery_queue = events
    .filter((event: any) => {
      if (event.stage === 'FAILED' || event.stage === 'REVIEW_REQUIRED' || event.stage === 'RECOVERY_REQUIRED') return true;
      if (event.stage === 'UPLOADED') return !terminalIntakes.has(event.intake_id || event.message_id);
      return false;
    })
    .map((event: any) => {
      const text = `${event.error || ''}`.toLowerCase();
      const category = event.stage === 'RECOVERY_REQUIRED' ? 'SOURCE_RECOVERY_REQUIRED'
        : event.metadata?.upload_only_intake ? 'UPLOAD_ONLY'
        : /ocr|provider|timeout|rate limit|429|object/.test(text) ? 'OCR_FAILED'
          : /invoice number|amount|confidence/.test(text) ? 'EXTRACTION_REVIEW'
            : /proforma|non-invoice|shipping|statement/.test(text) ? 'NON_INVOICE_REVIEW'
              : /duplicate/.test(text) ? 'DUPLICATE_REVIEW' : 'FAILED';
      return { ...event, category };
    });
  return { latest_poll_at: latestPoll?.created_at || null, failures_24h: failures24h, events, recovery_queue, review_records: reviewRecords };
}
