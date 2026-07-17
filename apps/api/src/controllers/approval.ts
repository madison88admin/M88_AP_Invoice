import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createApprovalRequest,
  approveInvoice,
  rejectInvoice,
  getPendingApprovals,
  batchApproveInvoices,
} from '../services/approvalService';
import { logAudit } from '../services/auditLogService';

export const requestApproval = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const approvals = await createApprovalRequest(id, req.user!.id);
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'APPROVAL_REQUESTED',
      note: `Approval requested by ${req.user!.role}`,
    });
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
    const effectiveSignerName = signerName || req.user!.name || req.user!.email;
    const result = await approveInvoice(
      id,
      req.user!.id,
      req.user!.role,
      effectiveSignerName
    );
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'INVOICE_APPROVED',
      note: `Approved by ${req.user!.role}${effectiveSignerName ? ` (${effectiveSignerName})` : ''}`,
    });
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
    await logAudit({
      invoice_id: id,
      performed_by: req.user!.id,
      action: 'INVOICE_REJECTED',
      note: `Rejected by ${req.user!.role}. Reason: ${reason || 'No reason provided'}`,
    });
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
    await logAudit({
      performed_by: req.user!.id,
      action: 'INVOICE_BATCH_APPROVED',
      note: `Batch approved ${invoiceIds.length} invoice(s) by ${req.user!.role}`,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};
