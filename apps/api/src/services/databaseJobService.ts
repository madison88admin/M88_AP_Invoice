import crypto from 'crypto';
import prisma from '../config/database';

export type DurableJobStatus = 'QUEUED' | 'PROCESSING' | 'RETRYING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';

export async function enqueueJob(input: { jobType: string; invoiceId?: string; payload?: any; createdBy?: string; idempotencyKey?: string; maxAttempts?: number }) {
  const key = input.idempotencyKey || `${input.jobType}:${input.invoiceId || 'none'}:${crypto.randomUUID()}`;
  return prisma.asyncJob.upsert({
    where: { idempotency_key: key },
    update: {},
    create: {
      job_type: input.jobType,
      invoice_id: input.invoiceId,
      payload: input.payload,
      created_by: input.createdBy,
      idempotency_key: key,
      max_attempts: input.maxAttempts || 5,
    },
  });
}

/** Atomic PostgreSQL claim; SKIP LOCKED allows multiple workers without duplicate execution. */
export async function claimNextJob(workerId: string, jobTypes?: string[]) {
  const types = jobTypes?.length ? jobTypes : ['VALIDATE_INVOICE', 'CHECK_NEXTGEN'];
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    WITH candidate AS (
      SELECT id FROM "APInvoice_AsyncJob"
      WHERE status IN ('QUEUED','RETRYING')
        AND available_at <= NOW()
        AND job_type = ANY($1::text[])
      ORDER BY available_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "APInvoice_AsyncJob" job
    SET status='PROCESSING', claimed_at=NOW(), claimed_by=$2, attempts=attempts+1, updated_at=NOW()
    FROM candidate WHERE job.id=candidate.id
    RETURNING job.*
  `, types, workerId);
  return rows[0] || null;
}

export async function completeDurableJob(id: string, result: any) {
  return prisma.asyncJob.update({ where: { id }, data: { status: 'COMPLETED', result, error: null, completed_at: new Date() } });
}

export async function retryOrDeadLetterJob(job: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (job.attempts >= job.max_attempts) {
    return prisma.asyncJob.update({ where: { id: job.id }, data: { status: 'DEAD_LETTER', error: message, completed_at: new Date() } });
  }
  const delaySeconds = Math.min(900, 15 * (2 ** Math.max(0, job.attempts - 1)));
  return prisma.asyncJob.update({ where: { id: job.id }, data: { status: 'RETRYING', error: message, claimed_at: null, claimed_by: null, available_at: new Date(Date.now() + delaySeconds * 1000) } });
}

export async function getDurableJob(id: string) {
  return prisma.asyncJob.findUnique({ where: { id } });
}

export async function recoverAbandonedJobs(ageMinutes = 15) {
  return prisma.asyncJob.updateMany({
    where: { status: 'PROCESSING', claimed_at: { lt: new Date(Date.now() - ageMinutes * 60_000) } },
    data: { status: 'RETRYING', claimed_at: null, claimed_by: null, available_at: new Date(), error: 'Worker lease expired; job recovered after restart.' },
  });
}
