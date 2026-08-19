import { Router } from 'express';
import { UserRole } from '@ap-invoice/shared';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { listFinanceControlRuns, startFinanceControlRun, updateFindingWorkflow } from '../services/financeControlRunService';

const router: Router = Router();
router.use(authenticate);
router.get('/runs', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req, res, next) => {
  try { res.json(await listFinanceControlRuns(typeof req.query.type === 'string' ? req.query.type : undefined)); } catch (error) { next(error); }
});
// Scans run in the background: the response only acknowledges the run, the
// client polls GET /runs until the run leaves RUNNING.
router.post('/anomaly-scan', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req: AuthRequest, res, next) => {
  try { res.status(202).json(await startFinanceControlRun('ANOMALY', req.user!.id)); } catch (error) { next(error); }
});
router.post('/reconcile', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req: AuthRequest, res, next) => {
  try { res.status(202).json(await startFinanceControlRun('FOUR_WAY_RECONCILIATION', req.user!.id)); } catch (error) { next(error); }
});
router.patch('/findings/:id', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req: AuthRequest, res, next) => {
  try {
    res.json(await updateFindingWorkflow(req.params.id, String(req.body.action || ''), req.user!.id, {
      assignedTo: req.body.assigned_to,
      note: req.body.note,
      escalateTo: req.body.escalate_to,
    }));
  } catch (error) { next(error); }
});
export default router;
