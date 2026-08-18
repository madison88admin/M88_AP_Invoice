import { Response, NextFunction, Request } from 'express';
import { AuthRequest } from '../middleware/auth';
import { validateInvoice, checkNextGenChanges } from '../services/validationService';
import { logAudit } from '../services/auditLogService';
import { enqueueJob, getDurableJob } from '../services/databaseJobService';

// Format failing validation rules into a readable audit note so the trail shows
// exactly what failed and what changed (amounts, variance, vendor, etc.).
function buildValidationAuditNote(result: any): string {
  const failing = (result?.results || [])
    .filter((r: any) => !r.passed)
    .map((r: any) => `${r.message}${r.detail ? ` — ${r.detail}` : ''}`);
  const note = `Validation completed. Passed: ${result?.passed}. Rules checked: ${result?.results?.length || 0}`
    + (failing.length > 0 ? `. Failing: ${failing.join(' | ')}` : '');
  // Keep the audit note bounded even when OCR/NextGen details are verbose
  return note.length > 2000 ? note.slice(0, 2000) + '…' : note;
}

export const validateInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await validateInvoice(id);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'INVOICE_VALIDATED',
      note: buildValidationAuditNote(result),
    });
    res.json(result);
  } catch (error) {
    await logAudit({
      invoice_id: req.params.id,
      performed_by: req.user?.id,
      action: 'INVOICE_VALIDATION_FAILED',
      note: `Validation failed: ${(error as Error).message || error}`,
    });
    next(error);
  }
};

export const validateInvoiceAsyncController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const job = await enqueueJob({ jobType: 'VALIDATE_INVOICE', invoiceId: id, createdBy: userId, idempotencyKey: `validate:${id}:${req.body?.revision || 'current'}` });
    res.status(202).json({ jobId: job.id, status: job.status.toLowerCase(), message: 'Validation queued durably' });
  } catch (error) {
    next(error);
  }
};

export const checkNextGenChangesController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await checkNextGenChanges(id);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'NEXTGEN_CHECK',
      note: `NextGen change check completed. Has changes: ${result.hasChanges}. Changes: ${result.changes.length}`,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const checkNextGenAsyncController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const job = await enqueueJob({ jobType: 'CHECK_NEXTGEN', invoiceId: id, createdBy: userId, idempotencyKey: `nextgen:${id}:${req.body?.revision || 'current'}` });
    res.status(202).json({ jobId: job.id, status: job.status.toLowerCase(), message: 'NextGen check queued durably' });
  } catch (error) {
    next(error);
  }
};

export const getJobStatusController = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const job = await getDurableJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: { message: 'Job not found', status: 404 } });
      return;
    }
    res.json({
      jobId: job.id,
      status: job.status.toLowerCase(),
      attempts: job.attempts,
      result: job.status === 'COMPLETED' ? job.result : undefined,
      error: ['FAILED', 'DEAD_LETTER'].includes(job.status) ? job.error : undefined,
    });
  } catch (error) {
    next(error);
  }
};
