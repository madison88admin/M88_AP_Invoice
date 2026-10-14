import { UserRole } from '@ap-invoice/shared';
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
    await prisma.emailIntakeEvent.create({
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
