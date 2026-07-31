import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import * as invoiceService from '../services/invoiceService';
import { InvoiceStatus, InvoiceType, InvoiceCategory } from '@ap-invoice/shared';

export const createInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const invoiceData = req.body;
    const invoice = await invoiceService.createInvoice(invoiceData, req.user!.id, req.user!.role);
    res.status(201).json(invoice);
  } catch (error) {
    next(error);
  }
};

export const getDistinctPaymentTerms = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const terms = await invoiceService.getDistinctPaymentTerms();
    res.json(terms);
  } catch (error) {
    next(error);
  }
};

export const getInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const filters = {
      status: req.query.status as InvoiceStatus | undefined,
      vendor: req.query.vendor as string | undefined,
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
      type: req.query.type as InvoiceType | undefined,
      category: req.query.category as InvoiceCategory | undefined,
    };
    
    const invoices = await invoiceService.getInvoices(filters, req.user?.role);
    res.json(invoices);
  } catch (error) {
    next(error);
  }
};

export const getInvoiceById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id);
    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

export const getInvoiceTimeline = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const invoice = await invoiceService.getInvoiceTimeline(req.params.id);
    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

export const updateInvoiceStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status } = req.body;
    const invoice = await invoiceService.updateInvoiceStatus(
      req.params.id,
      status,
      req.user!.id
    );
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

export const updateInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const invoice = await invoiceService.updateInvoice(
      req.params.id,
      req.body,
      req.user!.id,
      req.user!.role,
      req.user!.name
    );
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

export const deleteInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await invoiceService.deleteInvoice(
      req.params.id,
      req.user!.id,
      req.user!.role,
      req.user!.name
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const requestBankDetailsChange = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { field, current_value, requested_value, reason } = req.body;
    if (!field || !requested_value || !reason) {
      throw new AppError('Field, requested_value, and reason are required', 400);
    }
    const file = (req as any).file;
    const attachment = file ? {
      filename: file.originalname,
      data: file.buffer,
      mimetype: file.mimetype,
    } : undefined;
    const result = await invoiceService.requestBankDetailsChange(
      req.params.id,
      { field, current_value, requested_value, reason },
      req.user!.id,
      req.user!.name,
      attachment
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getBankChangeRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await invoiceService.getBankChangeRequests();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getBankChangeRequestsForInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await invoiceService.getBankChangeRequestsForInvoice(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const downloadBankChangeAttachment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await invoiceService.getBankChangeAttachment(req.params.requestId);
    if (!result) {
      throw new AppError('Attachment not found', 404);
    }
    res.setHeader('Content-Type', result.attachment_mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${result.attachment_filename}"`);
    res.send(result.attachment_data);
  } catch (error) {
    next(error);
  }
};

export const approveBankChangeRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await invoiceService.approveBankChangeRequest(
      req.params.requestId,
      req.user!.id,
      req.user!.name
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const rejectBankChangeRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { reason } = req.body;
    const result = await invoiceService.rejectBankChangeRequest(
      req.params.requestId,
      req.user!.id,
      req.user!.name,
      reason
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
};
