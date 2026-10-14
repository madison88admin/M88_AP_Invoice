import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { importQuickBooksRows, listQuickBooksReconciliations, recordQuickBooksReconciliation, resolveQuickBooksReconciliation } from '../services/quickBooksReconciliationService';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await listQuickBooksReconciliations({
      result: req.query.result as string | undefined,
      resolution_status: req.query.resolution_status as string | undefined,
      invoice_id: req.query.invoice_id as string | undefined,
    }));
  } catch (error) { next(error); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await recordQuickBooksReconciliation({ ...req.body }, req.user!.id));
  } catch (error) { next(error); }
}

export async function resolve(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await resolveQuickBooksReconciliation(req.params.id, req.user!.id, req.body?.comments));
  } catch (error) { next(error); }
}

export async function importRows(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
    res.status(201).json(await importQuickBooksRows(rows, req.user!.id));
  } catch (error) { next(error); }
}

