import { Router } from 'express';
import { UserRole } from '@ap-invoice/shared';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { listFinanceControlRuns, runAnomalyScan, runFourWayReconciliation, updateFindingWorkflow } from '../services/financeControlRunService';

const router: Router = Router();
router.use(authenticate);
router.get('/runs', authorize(UserRole.ACCOUNTING_ASSOCIATE, UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req, res, next) => {
  try { res.json(await listFinanceControlRuns(typeof req.query.type === 'string' ? req.query.type : undefined)); } catch (error) { next(error); }
});
router.post('/anomaly-scan', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req: AuthRequest, res, next) => {
  try { res.json(await runAnomalyScan(req.user!.id)); } catch (error) { next(error); }
});
router.post('/reconcile', authorize(UserRole.ACCOUNTING_SUPERVISOR, UserRole.CFO), async (req: AuthRequest, res, next) => {
  try { res.json(await runFourWayReconciliation(req.user!.id)); } catch (error) { next(error); }
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
