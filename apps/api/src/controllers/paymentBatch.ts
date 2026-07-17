import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createPaymentBatch,
  createGroupedPaymentBatches,
  getPaymentBatches,
  getPaymentBatchById,
  getScheduledPaymentsForBatch,
  processPaymentBatch,
  cancelPaymentBatch,
  selectPaymentsForBatch,
  deselectPaymentsForBatch,
  submitPaymentBatchForReview,
  reviewPaymentBatch,
  returnPaymentBatch,
  markPaymentBatchExported,
} from '../services/paymentBatchService';

export const createPaymentBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentIds } = req.body;
    const result = await createGroupedPaymentBatches(paymentIds, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getScheduledPaymentsForBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const payments = await getScheduledPaymentsForBatch({
      vendorId: req.query.vendorId as string | undefined,
      currency: req.query.currency as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.json(payments);
  } catch (error) {
    next(error);
  }
};

export const submitPaymentBatchController = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await submitPaymentBatchForReview(req.params.batchId, req.user!.id)); } catch (error) { next(error); }
};

export const reviewPaymentBatchController = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await reviewPaymentBatch(req.params.batchId, req.user!.id, req.body.note)); } catch (error) { next(error); }
};

export const returnPaymentBatchController = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await returnPaymentBatch(req.params.batchId, req.user!.id, req.body.reason)); } catch (error) { next(error); }
};

export const exportPaymentBatchController = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try { res.json(await markPaymentBatchExported(req.params.batchId, req.user!.id)); } catch (error) { next(error); }
};

export const getPaymentBatchesController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const batches = await getPaymentBatches();
    res.json(batches);
  } catch (error) {
    next(error);
  }
};

export const getPaymentBatchByIdController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { batchId } = req.params;
    const batch = await getPaymentBatchById(batchId);
    res.json(batch);
  } catch (error) {
    next(error);
  }
};

export const processPaymentBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { batchId } = req.params;
    const result = await processPaymentBatch(batchId, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const cancelPaymentBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { batchId } = req.params;
    const { reason } = req.body;
    const result = await cancelPaymentBatch(batchId, req.user!.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const selectPaymentsForBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentIds } = req.body;
    const result = await selectPaymentsForBatch(paymentIds, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const deselectPaymentsForBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentIds } = req.body;
    const result = await deselectPaymentsForBatch(paymentIds, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
