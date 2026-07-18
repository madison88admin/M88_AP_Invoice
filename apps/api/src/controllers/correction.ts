import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { correctionLogService } from '../services/correctionLogService';
import { fieldDecisionEngine } from '../services/fieldDecisionEngine';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../services/auditLogService';

export const saveCorrection = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const invoiceId = req.params.id;
    const { vendor_name, invoice_template_type, raw_text, original_fields, corrected_fields, note, layout_fingerprint } = req.body;

    if (!corrected_fields || Object.keys(corrected_fields).length === 0) {
      throw new AppError('corrected_fields is required', 400);
    }

    await fieldDecisionEngine.saveCorrection({
      invoice_id: invoiceId,
      vendor_name,
      invoice_template_type,
      raw_text,
      original_fields,
      corrected_fields,
      note,
      layout_fingerprint,
    });

    await logAudit({
      invoice_id: invoiceId,
      performed_by: req.user?.id,
      action: 'CORRECTION_SAVED',
      note: `Correction saved for vendor ${vendor_name || 'unknown'}. Fields: ${Object.keys(corrected_fields).join(', ')}`,
    });

    res.status(201).json({
      success: true,
      message: 'Correction saved and queued for manager approval before vendor learning',
    });
  } catch (error) {
    next(error);
  }
};

export const saveStandaloneCorrection = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { vendor_name, invoice_template_type, raw_text, original_fields, corrected_fields, note, layout_fingerprint } = req.body;

    if (!corrected_fields || Object.keys(corrected_fields).length === 0) {
      throw new AppError('corrected_fields is required', 400);
    }

    await fieldDecisionEngine.saveCorrection({
      vendor_name,
      invoice_template_type,
      raw_text,
      original_fields,
      corrected_fields,
      note,
      layout_fingerprint,
    });

    await logAudit({
      performed_by: req.user?.id,
      action: 'CORRECTION_SAVED',
      note: `Standalone correction saved for vendor ${vendor_name || 'unknown'}. Fields: ${Object.keys(corrected_fields).join(', ')}`,
    });

    res.status(201).json({
      success: true,
      message: 'Correction saved and queued for manager approval before vendor learning',
    });
  } catch (error) {
    next(error);
  }
};

export const getSimilarCorrections = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { raw_text, vendor_name, invoice_template_type, limit } = req.body;

    const corrections = await correctionLogService.findSimilarCorrections(
      raw_text || '',
      vendor_name,
      invoice_template_type,
      limit ? Number(limit) : 3
    );

    res.json({
      success: true,
      count: corrections.length,
      corrections,
    });
  } catch (error) {
    next(error);
  }
};
