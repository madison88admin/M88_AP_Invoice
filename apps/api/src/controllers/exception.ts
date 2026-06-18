import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  resolveException,
  getPendingExceptions,
  getExceptionsByInvoice,
  waiveException,
  autoResolveLowRiskExceptions,
} from '../services/exceptionService';

export const resolveExceptionController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { exceptionId } = req.params;
    const { resolution } = req.body;
    const result = await resolveException(exceptionId, resolution, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const waiveExceptionController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { exceptionId } = req.params;
    const { waiverReason } = req.body;
    const result = await waiveException(exceptionId, waiverReason, req.user!.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getPendingExceptionsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const exceptions = await getPendingExceptions();
    res.json(exceptions);
  } catch (error) {
    next(error);
  }
};

export const getExceptionsByInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoiceId } = req.params;
    const exceptions = await getExceptionsByInvoice(invoiceId);
    res.json(exceptions);
  } catch (error) {
    next(error);
  }
};

export const autoResolveExceptionsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoiceId } = req.params;
    const result = await autoResolveLowRiskExceptions(invoiceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
