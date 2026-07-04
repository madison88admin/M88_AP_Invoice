import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { validateInvoice } from '../services/validationService';
import { logAudit } from '../services/auditLogService';

export const validateInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const result = await validateInvoice(id);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'INVOICE_VALIDATED',
      note: `Validation completed. Passed: ${result?.passed}. Rules checked: ${result?.results?.length || 0}`,
    });
    res.json(result);
  } catch (error) {
    await logAudit({
      invoice_id: req.params.id,
      performed_by: req.user?.id,
      action: 'INVOICE_VALIDATION_FAILED',
      note: `Validation failed: ${(error as Error).message || error}`,
    });
    next(error);
  }
};
