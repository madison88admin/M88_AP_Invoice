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
  | 'CREATED'
  | 'FAILED';

type IntakeEventInput = {
  source: 'GRAPH' | 'POWER_AUTOMATE' | 'SHAREPOINT';
  stage: EmailIntakeStage;
  status?: 'SUCCESS' | 'FAILED';
  mailbox?: string;
  messageId?: string;
  attachmentId?: string;
  fileName?: string;
  invoiceId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export async function recordEmailIntakeEvent(input: IntakeEventInput): Promise<void> {
  try {
    await prisma.emailIntakeEvent.create({
      data: {
        source: input.source,
        stage: input.stage,
        status: input.status || (input.stage === 'FAILED' || input.stage === 'POLL_FAILED' ? 'FAILED' : 'SUCCESS'),
        mailbox: input.mailbox,
        message_id: input.messageId,
        attachment_id: input.attachmentId,
        file_name: input.fileName,
        invoice_id: input.invoiceId,
        error: input.error?.slice(0, 2000),
        metadata: input.metadata as any,
      },
    });
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
  const [events, latestPoll, failures24h] = await Promise.all([
    prisma.emailIntakeEvent.findMany({ orderBy: { created_at: 'desc' }, take: safeLimit }),
    prisma.emailIntakeEvent.findFirst({ where: { source: 'GRAPH', stage: 'POLL_SUCCESS' }, orderBy: { created_at: 'desc' } }),
    prisma.emailIntakeEvent.count({ where: { status: 'FAILED', created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);
  return { latest_poll_at: latestPoll?.created_at || null, failures_24h: failures24h, events };
}
