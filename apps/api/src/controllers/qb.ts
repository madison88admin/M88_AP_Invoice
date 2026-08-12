import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { exportQBBills } from '../services/qbExportService';

export const exportQBBillsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await exportQBBills(
      {
        status: req.query.status as string | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
      },
      req.user!.id
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.setHeader('X-QB-Bill-Count', String(result.billCount));

    res.send(result.buffer);
  } catch (error) {
    next(error);
  }
};
