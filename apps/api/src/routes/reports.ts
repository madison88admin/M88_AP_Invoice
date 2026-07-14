import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getInvoiceVolume,
  getPaymentStatus,
  getVendorSpending,
  getExceptionRate,
  getKPI,
  getForecast,
} from '../controllers/reports';

const router: Router = Router();

router.use(authenticate);

router.get('/invoice-volume', getInvoiceVolume);
router.get('/payment-status', getPaymentStatus);
router.get('/vendor-spending', getVendorSpending);
router.get('/exception-rate', getExceptionRate);
router.get('/kpi', getKPI);
router.get('/forecast', getForecast);

export default router;
