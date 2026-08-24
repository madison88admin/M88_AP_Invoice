import crypto from 'crypto';
import { claimNextJob, completeDurableJob, recoverAbandonedJobs, retryOrDeadLetterJob } from './databaseJobService';
import { validateInvoice, checkNextGenChanges } from './validationService';
import { logAudit } from './auditLogService';
import { logger } from '../utils/logger';

const workerId = `${process.pid}-${crypto.randomUUID()}`;
let timer: NodeJS.Timeout | undefined;
let running = false;

async function processOne() {
  if (running) return;
  running = true;
  try {
    const job = await claimNextJob(workerId);
    if (!job) return;
    try {
      if (!job.invoice_id) throw new Error('Job has no invoice id');
      const result = job.job_type === 'VALIDATE_INVOICE'
        ? await validateInvoice(job.invoice_id)
        : await checkNextGenChanges(job.invoice_id);
      await logAudit({
        invoice_id: job.invoice_id,
        performed_by: job.created_by || undefined,
        action: job.job_type === 'VALIDATE_INVOICE' ? 'INVOICE_VALIDATED' : 'NEXTGEN_CHECK',
        note: `Durable job ${job.id} completed`,
        metadata: { job_id: job.id, attempts: job.attempts, result },
        correlation_id: job.id,
      });
      await completeDurableJob(job.id, result);
    } catch (error) {
      await retryOrDeadLetterJob(job, error);
    }
  } catch (error) {
    logger.error('Durable job worker error:', error);
  } finally {
    running = false;
  }
}

export async function startDurableJobWorker() {
  try {
    await recoverAbandonedJobs();
  } catch (error) {
    logger.warn('Durable job worker: could not recover abandoned jobs (DB may be unavailable) — continuing without recovery');
  }
  timer = setInterval(() => void processOne(), Number(process.env.DURABLE_JOB_POLL_MS || 1000));
  timer.unref();
  logger.info(`Durable finance job worker started (${workerId})`);
}

export function stopDurableJobWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
