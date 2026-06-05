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
    const invoice = await invoiceService.createInvoice(invoiceData, req.user!.id);
    res.status(201).json(invoice);
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
    
    const invoices = await invoiceService.getInvoices(filters);
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
