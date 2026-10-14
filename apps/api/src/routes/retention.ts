import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '@ap-invoice/shared';
import prisma from '../config/database';
import { attestRetentionBackup, completeControlledDisposal, runRetentionComplianceJob, setRetentionLegalHold } from '../services/retentionComplianceService';

const router: Router = Router();
const retentionRoles = [UserRole.ACCOUNTING_SUPERVISOR, UserRole.IT_ADMIN, UserRole.SUPERADMIN] as const;
router.use(authenticate);

router.get('/queue', authorize(...retentionRoles), async (_req, res, next) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT r.*, i.invoice_number, i.status AS invoice_status, i.retention_until AS invoice_retention_until, i.legal_hold AS invoice_legal_hold FROM "APInvoice_RetentionDisposition" r JOIN "APInvoice_Invoice" i ON i.id=r.invoice_id ORDER BY r.retention_until ASC LIMIT 1000`);
    res.json({ rows });
  } catch (error) { next(error); }
});

router.post('/run', authorize(...retentionRoles), async (_req, res, next) => {
  try { res.json(await runRetentionComplianceJob()); } catch (error) { next(error); }
});

router.post('/:invoiceId/backup-attestation', authorize(...retentionRoles), async (req: any, res, next) => {
  try {
    const record = await attestRetentionBackup(req.params.invoiceId, req.user!.id, { reference: req.body?.reference, hash: req.body?.hash });
    res.json({ record });
  } catch (error) { next(error); }
});

router.post('/:invoiceId/legal-hold', authorize(...retentionRoles), async (req: any, res, next) => {
  try {
    const enabled = req.body?.enabled !== false;
    const record = await setRetentionLegalHold(req.params.invoiceId, req.user!.id, enabled, req.body?.reason);
    res.json({ record });
  } catch (error) { next(error); }
});

router.post('/:invoiceId/dispose', authorize(...retentionRoles), async (req: any, res, next) => {
  try {
    const record = await completeControlledDisposal(req.params.invoiceId, req.user!.id, req.body?.reason);
    res.json({ record, deleted: false, message: 'Controlled disposal recorded; retained evidence was not hard-deleted.' });
  } catch (error) { next(error); }
});

export default router;
