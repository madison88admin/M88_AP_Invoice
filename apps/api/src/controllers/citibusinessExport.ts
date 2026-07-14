import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { exportBatchToCitiBusiness, exportMultipleBatchesToCitiBusiness } from '../services/citibusinessExportService';

export const exportBatchCitiBusiness = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { batchId } = req.params;
    const result = await exportBatchToCitiBusiness(batchId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.csv);
  } catch (error) {
    next(error);
  }
};

export const exportAllCitiBusiness = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { startDate, endDate } = req.query;

    const result = await exportMultipleBatchesToCitiBusiness(
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.csv);
  } catch (error) {
    next(error);
  }
};
