import { Router } from 'express';
import { UserRole } from '@ap-invoice/shared';
import { authenticate, authorize } from '../middleware/auth';
import { getEmailIntakeMonitor } from '../services/emailIntakeMonitoringService';
import { getEvidenceShadowReport } from '../services/evidenceShadowReportService';

const router: Router = Router();
router.use(authenticate);

router.get('/', authorize(
  UserRole.PURCHASING_MANAGER,
  UserRole.ACCOUNTING_ASSOCIATE,
  UserRole.ACCOUNTING_SUPERVISOR,
  UserRole.IT_ADMIN,
), async (req, res, next) => {
  try {
    res.json(await getEmailIntakeMonitor(Number(req.query.limit || 100)));
  } catch (error) {
    next(error);
  }
});

router.get('/evidence-shadow-report', authorize(
  UserRole.ACCOUNTING_SUPERVISOR,
  UserRole.IT_ADMIN,
), async (req, res, next) => {
  try {
    res.json(await getEvidenceShadowReport(Number(req.query.limit || 5000)));
  } catch (error) { next(error); }
});

export default router;
