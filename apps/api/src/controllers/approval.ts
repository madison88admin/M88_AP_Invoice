import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createApprovalRequest,
  approveInvoice,
  rejectInvoice,
  getPendingApprovals,
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
