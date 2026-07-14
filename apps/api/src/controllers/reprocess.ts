import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { reprocessInvoice, reprocessInvoices } from '../services/reprocessService';

export const reprocessInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Reason is required for reprocessing' });
    }

    const result = await reprocessInvoice(id, req.user!.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const reprocessInvoicesController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoiceIds, reason } = req.body;

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'invoiceIds array is required' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Reason is required for reprocessing' });
    }

    const result = await reprocessInvoices(invoiceIds, req.user!.id, reason);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
