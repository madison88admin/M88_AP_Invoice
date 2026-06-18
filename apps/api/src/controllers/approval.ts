import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createApprovalRequest,
  approveInvoice,
  rejectInvoice,
  getPendingApprovals,
  batchApproveInvoices,
} from '../services/approvalService';

export const requestApproval = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const approvals = await createApprovalRequest(id, req.user!.id);
    res.json({ message: 'Approval request created', approvals });
  } catch (error) {
    next(error);
  }
};

export const approveInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { signerName } = req.body;
    const result = await approveInvoice(
      id,
      req.user!.id,
      req.user!.role,
      signerName
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const rejectInvoiceController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await rejectInvoice(
      id,
      req.user!.id,
      req.user!.role,
      reason
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getPendingApprovalsController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const approvals = await getPendingApprovals(req.user!.role);
    res.json(approvals);
  } catch (error) {
    next(error);
  }
};

export const batchApproveController = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoiceIds, signerName } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'invoiceIds must be a non-empty array' });
    }
    if (invoiceIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 invoices per batch' });
    }
    const result = await batchApproveInvoices(
      invoiceIds,
      req.user!.id,
      req.user!.role,
      signerName
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};
