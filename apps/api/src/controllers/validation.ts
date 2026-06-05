import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { validateInvoice } from '../services/validationService';

export const validateInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await validateInvoice(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
