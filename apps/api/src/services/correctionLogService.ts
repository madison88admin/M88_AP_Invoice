import prisma from '../config/database';
import { logger } from '../utils/logger';
import { ollamaFineTuneService } from './ollamaFineTuneService';

export interface CorrectionFields {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  total_amount?: number;
  currency?: string;
  po_number?: string;
  mpo_number?: string;
  brand?: string;
  brand_code?: string;
  season?: string;
  payment_terms?: string;
  ship_to?: string;
  sold_to?: string;
  line_items?: any[];
  [key: string]: any;
}

export interface SaveCorrectionInput {
  invoice_id?: string;
  vendor_name?: string;
  invoice_template_type?: string;
  raw_text?: string;
  original_fields?: CorrectionFields;
  corrected_fields?: CorrectionFields;
  note?: string;
  layout_fingerprint?: string;
}

export function correctionVendorScopeKey(vendorName?: string): string | null {
  if (!vendorName) return null;
  const key = vendorName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return key || null;
}

export class CorrectionLogService {
  private static instance: CorrectionLogService;

  static getInstance(): CorrectionLogService {
    if (!CorrectionLogService.instance) {
      CorrectionLogService.instance = new CorrectionLogService();
    }
    return CorrectionLogService.instance;
  }

  async saveCorrection(input: SaveCorrectionInput) {
    try {
      const log = await prisma.correctionLog.create({
        data: {
          invoice_id: input.invoice_id,
          vendor_name: input.vendor_name,
          invoice_template_type: input.invoice_template_type,
          raw_text: input.raw_text,
          original_fields: input.original_fields as any,
          corrected_fields: input.corrected_fields as any,
          note: input.note,
          vendor_scope_key: correctionVendorScopeKey(input.vendor_name),
          layout_fingerprint: input.layout_fingerprint,
          approved_for_learning: false,
        },
      });

      logger.info(`Correction log saved: ${log.id}`);

      // Trigger auto-retrain every 50 corrections
      const autoRetrainThreshold = Number(process.env.AUTO_RETRAIN_CORRECTIONS) || 50;
      const totalCount = await prisma.correctionLog.count();
      if (autoRetrainThreshold > 0 && totalCount % autoRetrainThreshold === 0) {
        const status = ollamaFineTuneService.getStatus();
        if (!status.isRunning) {
          logger.info(`Auto-retrain triggered at ${totalCount} corrections`);
          try {
            ollamaFineTuneService.startFineTune();
          } catch (err) {
            logger.error('Auto-retrain failed:', err);
          }
        } else {
          logger.info('Auto-retrain skipped: fine-tuning already running');
        }
      }

      return log;
    } catch (error) {
      logger.error('Failed to save correction log:', error);
      throw error;
    }
  }

  async findSimilarCorrections(
    rawText: string,
    vendorName?: string,
    invoiceTemplateType?: string,
    limit: number = 3,
    allowCrossVendor: boolean = false
  ) {
    try {
      let corrections: any[] = [];

      // Vendor learning is strictly isolated. Never borrow rules from another vendor.
      const vendorScopeKey = correctionVendorScopeKey(vendorName);
      if (vendorScopeKey) {
        corrections = await prisma.correctionLog.findMany({
          where: {
            vendor_scope_key: vendorScopeKey,
            approved_for_learning: true,
            disabled_at: null,
          },
          orderBy: [{ use_count: 'desc' }, { created_at: 'desc' }],
          take: limit,
        });
      }

      // Template rules are only used when the vendor is unknown and the rule was approved.
      if (corrections.length === 0 && !vendorScopeKey && invoiceTemplateType) {
        corrections = await prisma.correctionLog.findMany({
          where: {
            invoice_template_type: invoiceTemplateType,
            approved_for_learning: true,
            disabled_at: null,
          },
          orderBy: [{ use_count: 'desc' }, { created_at: 'desc' }],
          take: limit,
        });
      }

      // Cross-vendor examples must be explicitly requested; normal extraction never enables this.
      if (corrections.length === 0 && allowCrossVendor && !vendorScopeKey && !invoiceTemplateType) {
        corrections = await prisma.correctionLog.findMany({
          where: { approved_for_learning: true, disabled_at: null },
          orderBy: [{ use_count: 'desc' }, { created_at: 'desc' }],
          take: limit,
        });
      }

      if (corrections.length > 0) {
        await prisma.correctionLog.updateMany({
          where: { id: { in: corrections.map((c: { id: string }) => c.id) } },
          data: {
            use_count: { increment: 1 },
            last_used_at: new Date(),
          },
        });
      }

      return corrections;
    } catch (error) {
      logger.error('Failed to find similar corrections:', error);
      return [];
    }
  }

  formatFewShotPrompt(corrections: any[]): string {
    if (corrections.length === 0) return '';

    const examples = corrections
      .map((c, index) => {
        const original = c.original_fields ? JSON.stringify(c.original_fields, null, 2) : '{}';
        const corrected = c.corrected_fields ? JSON.stringify(c.corrected_fields, null, 2) : '{}';
        return `Example ${index + 1}:
Original extraction:
${original}

Corrected extraction:
${corrected}
`;
      })
      .join('\n---\n');

    return `Below are previous manual corrections for similar invoices. Use them as a reference for extraction style and field values:

${examples}
`;
  }

  async getFewShotPrompt(
    rawText: string,
    vendorName?: string,
    invoiceTemplateType?: string,
    limit: number = 3
  ): Promise<string> {
    const corrections = await this.findSimilarCorrections(rawText, vendorName, invoiceTemplateType, limit);
    return this.formatFewShotPrompt(corrections);
  }
}

export const correctionLogService = CorrectionLogService.getInstance();
