import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  postInvoice,
  schedulePayment,
  processPayment,
  getScheduledPayments,
} from '../services/postingService';

export const postInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await postInvoice(id, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const schedulePaymentController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { paymentDate } = req.body;
    const result = await schedulePayment(id, new Date(paymentDate), req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const processPaymentController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { paymentId } = req.params;
    const result = await processPayment(paymentId, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getScheduledPaymentsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const payments = await getScheduledPayments();
    res.json(payments);
  } catch (error) {
    next(error);
  }
};
