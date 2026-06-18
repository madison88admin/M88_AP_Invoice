import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { analyzeInvoice } from '../services/ocrService';
import { matchVendor } from '../services/vendorMatchingService';
import { InvoiceStatus, SignatureType } from '@ap-invoice/shared';

export const uploadInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // Analyze invoice using OCR
    const ocrResult = await analyzeInvoice(fileBuffer, mimeType);

    // Match vendor
    let vendorId: string;
    try {
      const vendorMatch = await matchVendor(ocrResult.vendor_name);
      vendorId = vendorMatch.vendor_id;
    } catch (error) {
      // If vendor not found, return OCR result with vendor matching error
      return res.status(200).json({
        success: true,
        ocr_result: ocrResult,
        vendor_match: null,
        requires_manual_vendor_assignment: true,
      });
    }

    // Return OCR result with matched vendor
    res.status(200).json({
      success: true,
      ocr_result: ocrResult,
      vendor_match: {
        vendor_id: vendorId,
        vendor_name: ocrResult.vendor_name,
      },
      requires_manual_vendor_assignment: false,
    });
  } catch (error) {
    next(error);
  }
};

export const confirmOCR = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { invoice_id } = req.params;
    const {
      invoice_number,
      invoice_date,
      due_date,
      vendor_id,
      total_amount,
      currency,
      payment_terms,
      incoterm,
      bank_charges,
      freight_charges,
      invoice_type,
      category,
      bill_to_entity,
      bank_info,
      signatures,
      is_urgent,
      priority_flag,
    } = req.body;

    // Import invoice service dynamically to avoid circular dependency
    const invoiceService = await import('../services/invoiceService');

    // Create invoice record with RECEIVED status
    const invoice = await invoiceService.createInvoice(
      {
        invoice_number,
        invoice_date,
        due_date,
        invoice_received_date: new Date(),
        vendor_id,
        total_amount,
        currency,
        payment_terms,
        incoterm,
        bank_charges: bank_charges || 0,
        freight_charges: freight_charges || 0,
        invoice_type,
        category,
        bill_to_entity: bill_to_entity || 'MADISON_88_LTD',
        ocr_raw_data: {
          bank_info,
          signatures,
        },
        is_urgent: is_urgent || false,
        priority_flag: priority_flag || false,
      },
      req.user!.id
    );

    // Create signature records if detected
    if (signatures && signatures.length > 0) {
      const prisma = (await import('../config/database')).default;
      for (const sig of signatures) {
        await prisma.signature.create({
          data: {
            invoice_id: invoice.id,
            signatory_name: sig.signatory_name || sig.signer_name,
            signed_at: sig.signed_at ? new Date(sig.signed_at) : null,
            signatory_role: (sig.signatory_role || sig.role || 'COORDINATOR') as any,
            signature_type: (sig.signature_type || SignatureType.DIGITAL) as any,
          },
        });
      }
    }

    res.status(201).json(invoice);
  } catch (error) {
    next(error);
  }
};
