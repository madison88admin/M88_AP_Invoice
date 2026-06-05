import { Router } from 'express';
import {
  getInvoiceVolume,
  getPaymentStatus,
  getVendorSpending,
  getExceptionRate,
  getKPI,
} from '../controllers/reports';

const router = Router();

router.get('/invoice-volume', getInvoiceVolume);
router.get('/payment-status', getPaymentStatus);
router.get('/vendor-spending', getVendorSpending);
router.get('/exception-rate', getExceptionRate);
router.get('/kpi', getKPI);

export default router;
