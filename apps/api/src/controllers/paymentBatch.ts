import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createPaymentBatch,
  getPaymentBatches,
  getPaymentBatchById,
  getScheduledPaymentsForBatch,
  processPaymentBatch,
  approvePaymentBatchByCFO,
  cancelPaymentBatch,
  selectPaymentsForBatch,
  deselectPaymentsForBatch,
} from '../services/paymentBatchService';

export const createPaymentBatchController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentIds } = req.body;
    const result = await createPaymentBatch(paymentIds, req.user!.id);
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
    const payments = await getScheduledPaymentsForBatch();
    res.json(payments);
  } catch (error) {
    next(error);
  }
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

export const approvePaymentBatchByCFOController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { batchId } = req.params;
    const result = await approvePaymentBatchByCFO(batchId, req.user!.id);
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
