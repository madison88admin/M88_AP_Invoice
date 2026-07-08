import prisma from '../config/database';
import { logger } from '../utils/logger';
import { DecisionResult } from './fieldDecisionEngine';

// ============================================================================
// TYPES
// ============================================================================

export interface ActiveLearningQuestion {
  field: string;
  current_value: any;
  confidence: number;
  candidates: Array<{ engine: string; value: any; confidence: number }>;
  question: string;
  context_snippet?: string;
}

export interface ActiveLearningResult {
  needs_input: boolean;
  questions: ActiveLearningQuestion[];
  invoice_id?: string;
  vendor_name?: string;
}

export interface VendorTemplate {
  vendor_name: string;
  field_patterns: Record<string, {
    regex?: string;
    common_labels: string[];
    typical_position?: 'top' | 'middle' | 'bottom';
    expected_format?: string;
  }>;
  typical_currency: string;
  typical_payment_terms: string;
  invoice_number_pattern: string;
  bank_details: {
    bank_name?: string;
    account_number?: string;
    swift_code?: string;
  };
  confidence_baseline: number;
  sample_count: number;
  auto_generated: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// ACTIVE LEARNING SERVICE
// ============================================================================

export class ActiveLearningService {
  private static instance: ActiveLearningService;

  static getInstance(): ActiveLearningService {
    if (!ActiveLearningService.instance) {
      ActiveLearningService.instance = new ActiveLearningService();
    }
    return ActiveLearningService.instance;
  }

  /**
   * Generate questions for fields where the AI is uncertain.
   * Instead of asking the user to review the entire invoice, we only ask
   * about specific fields where confidence is low or engines disagree.
   */
  generateQuestions(
    decision: DecisionResult,
    options?: { invoiceId?: string; vendorName?: string; rawText?: string }
  ): ActiveLearningResult {
    const questions: ActiveLearningQuestion[] = [];

    for (const [fieldName, fieldDecision] of Object.entries(decision.fields)) {
      // Only ask about fields that have values but low confidence
      if (fieldDecision.final_value === null || fieldDecision.final_confidence >= 60) {
        continue;
      }

      // Skip non-critical fields
      const criticalFields = ['vendor_name', 'invoice_number', 'invoice_date', 'total_amount', 'po_number', 'mpo_number'];
      if (!criticalFields.includes(fieldName)) continue;

      const candidateValues = fieldDecision.candidates.map(c => ({
        engine: c.engine,
        value: c.value,
        confidence: c.confidence,
      }));

      const question = this.generateFieldQuestion(fieldName, fieldDecision.final_value, candidateValues);

      questions.push({
        field: fieldName,
        current_value: fieldDecision.final_value,
        confidence: fieldDecision.final_confidence,
        candidates: candidateValues,
        question,
        context_snippet: fieldDecision.evidence?.raw_text_snippet,
      });
    }

    return {
      needs_input: questions.length > 0,
      questions,
      invoice_id: options?.invoiceId,
      vendor_name: options?.vendorName,
    };
  }

  private generateFieldQuestion(
    field: string,
    currentValue: any,
    candidates: Array<{ engine: string; value: any; confidence: number }>
  ): string {
    const fieldLabels: Record<string, string> = {
      vendor_name: 'Vendor Name',
      invoice_number: 'Invoice Number',
      invoice_date: 'Invoice Date',
      total_amount: 'Total Amount',
      po_number: 'PO Number',
      mpo_number: 'MPO Number',
    };

    const label = fieldLabels[field] || field;
    const uniqueValues = [...new Set(candidates.map(c => String(c.value)))];

    if (uniqueValues.length === 1) {
      return `The AI extracted ${label} as "${currentValue}" but with low confidence (${candidates[0]?.confidence}%). Is this correct?`;
    }

    const options = candidates
      .map(c => `"${c.value}" (${c.engine}, ${c.confidence}%)`)
      .join(' or ');

    return `Engines disagree on ${label}. Options: ${options}. Which is correct?`;
  }
}

// ============================================================================
// VENDOR TEMPLATE AUTO-GENERATION
// ============================================================================

export class VendorTemplateService {
  private static instance: VendorTemplateService;

  static getInstance(): VendorTemplateService {
    if (!VendorTemplateService.instance) {
      VendorTemplateService.instance = new VendorTemplateService();
    }
    return VendorTemplateService.instance;
  }

  /**
   * Auto-generate a vendor template from historical invoices.
   * This detects patterns in how a vendor formats their invoices.
   */
  async autoGenerateTemplate(vendorName: string): Promise<VendorTemplate | null> {
    try {
      const invoices = await prisma.invoice.findMany({
        where: {
          vendor_name_raw: { contains: vendorName, mode: 'insensitive' },
          status: { in: ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'] },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: {
          invoice_number: true,
          currency: true,
          payment_terms: true,
          total_amount: true,
          bank_name: true,
          account_number: true,
          swift_code: true,
          ocr_raw_data: true,
          ocr_confidence_score: true,
        },
      });

      if (invoices.length < 3) {
        logger.info(`[VendorTemplate] Not enough invoices for ${vendorName} (${invoices.length}/3)`);
        return null;
      }

      // Detect invoice number pattern
      const invoiceNumbers = invoices.map(i => i.invoice_number).filter(n => n) as string[];
      const invoiceNumberPattern = this.detectPattern(invoiceNumbers);

      // Most common currency
      const currencies = invoices.map(i => i.currency).filter(c => c) as string[];
      const typicalCurrency = this.mostCommon(currencies) || 'USD';

      // Most common payment terms
      const paymentTerms = invoices.map(i => i.payment_terms).filter(p => p) as string[];
      const typicalPaymentTerms = this.mostCommon(paymentTerms) || '';

      // Bank details (most common)
      const bankNames = invoices.map(i => i.bank_name).filter(b => b) as string[];
      const accountNumbers = invoices.map(i => i.account_number).filter(a => a) as string[];
      const swiftCodes = invoices.map(i => i.swift_code).filter(s => s) as string[];

      // Field patterns from OCR raw data
      const fieldPatterns = this.extractFieldPatterns(invoices.map(i => i.ocr_raw_data as any));

      // Confidence baseline
      const scores = invoices.map(i => Number(i.ocr_confidence_score)).filter(s => !isNaN(s) && s > 0);
      const confidenceBaseline = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
        : 0;

      const template: VendorTemplate = {
        vendor_name: vendorName,
        field_patterns: fieldPatterns,
        typical_currency: typicalCurrency,
        typical_payment_terms: typicalPaymentTerms,
        invoice_number_pattern: invoiceNumberPattern,
        bank_details: {
          bank_name: this.mostCommon(bankNames) || undefined,
          account_number: this.mostCommon(accountNumbers) || undefined,
          swift_code: this.mostCommon(swiftCodes) || undefined,
        },
        confidence_baseline: confidenceBaseline,
        sample_count: invoices.length,
        auto_generated: true,
        created_at: new Date(),
        updated_at: new Date(),
      };

      logger.info(`[VendorTemplate] Auto-generated template for ${vendorName} from ${invoices.length} invoices`);

      // Save to vendor record if exists
      await this.saveTemplateToVendor(vendorName, template);

      return template;
    } catch (error) {
      logger.error(`[VendorTemplate] Failed to generate template for ${vendorName}:`, error);
      return null;
    }
  }

  /**
   * Predict missing fields based on vendor template.
   * If a field is missing from extraction but the vendor always uses the same value,
   * we can predict it with high confidence.
   */
  predictMissingFields(
    vendorName: string,
    extractedFields: Record<string, any>,
    template: VendorTemplate
  ): Array<{ field: string; predicted_value: any; confidence: number; reason: string }> {
    const predictions: Array<{ field: string; predicted_value: any; confidence: number; reason: string }> = [];

    // Predict currency
    if (!extractedFields.currency && template.typical_currency) {
      predictions.push({
        field: 'currency',
        predicted_value: template.typical_currency,
        confidence: 85,
        reason: `Vendor always uses ${template.typical_currency}`,
      });
    }

    // Predict payment terms
    if (!extractedFields.payment_terms && template.typical_payment_terms) {
      predictions.push({
        field: 'payment_terms',
        predicted_value: template.typical_payment_terms,
        confidence: 80,
        reason: `Vendor typically uses "${template.typical_payment_terms}"`,
      });
    }

    // Predict bank details
    if (template.bank_details.bank_name && !extractedFields.bank_name) {
      predictions.push({
        field: 'bank_name',
        predicted_value: template.bank_details.bank_name,
        confidence: 75,
        reason: 'Vendor historical bank details',
      });
    }

    if (template.bank_details.account_number && !extractedFields.account_number) {
      predictions.push({
        field: 'account_number',
        predicted_value: template.bank_details.account_number,
        confidence: 70,
        reason: 'Vendor historical account number',
      });
    }

    return predictions;
  }

  /**
   * Auto-detect new vendor layouts by checking if extracted data
   * significantly deviates from the vendor template.
   */
  async detectLayoutChange(vendorName: string, extractedData: Record<string, any>): Promise<{
    layout_changed: boolean;
    changes: Array<{ field: string; expected: any; actual: any; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  }> {
    const template = await this.getTemplate(vendorName);
    if (!template) {
      return { layout_changed: false, changes: [] };
    }

    const changes: Array<{ field: string; expected: any; actual: any; severity: 'HIGH' | 'MEDIUM' | 'LOW' }> = [];

    // Check currency
    if (extractedData.currency && template.typical_currency &&
        extractedData.currency.toUpperCase() !== template.typical_currency.toUpperCase()) {
      changes.push({
        field: 'currency',
        expected: template.typical_currency,
        actual: extractedData.currency,
        severity: 'MEDIUM',
      });
    }

    // Check invoice number pattern
    if (extractedData.invoice_number && template.invoice_number_pattern) {
      const actualPattern = extractedData.invoice_number.replace(/\d/g, '#');
      if (actualPattern !== template.invoice_number_pattern) {
        changes.push({
          field: 'invoice_number_pattern',
          expected: template.invoice_number_pattern,
          actual: actualPattern,
          severity: 'LOW',
        });
      }
    }

    // Check bank details
    if (extractedData.bank_name && template.bank_details.bank_name &&
        extractedData.bank_name.toLowerCase() !== template.bank_details.bank_name.toLowerCase()) {
      changes.push({
        field: 'bank_name',
        expected: template.bank_details.bank_name,
        actual: extractedData.bank_name,
        severity: 'HIGH',
      });
    }

    return {
      layout_changed: changes.length > 0,
      changes,
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private detectPattern(values: string[]): string {
    if (values.length === 0) return '';
    const toPattern = (s: string) => s.replace(/\d/g, '#');
    const patterns = values.map(toPattern);
    return this.mostCommon(patterns) || '';
  }

  private mostCommon(arr: string[]): string | undefined {
    if (arr.length === 0) return undefined;
    const counts = new Map<string, number>();
    for (const s of arr) {
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  private extractFieldPatterns(rawDataList: any[]): Record<string, any> {
    const patterns: Record<string, any> = {};

    // Collect labels used for each field
    const labelMap = new Map<string, Set<string>>();

    for (const rawData of rawDataList) {
      if (!rawData?.decision?.fields) continue;
      for (const [field, data] of Object.entries(rawData.decision.fields)) {
        const fd = data as any;
        if (fd.evidence?.matched_label) {
          if (!labelMap.has(field)) labelMap.set(field, new Set());
          labelMap.get(field)!.add(fd.evidence.matched_label);
        }
      }
    }

    for (const [field, labels] of labelMap) {
      patterns[field] = {
        common_labels: Array.from(labels),
      };
    }

    return patterns;
  }

  private async saveTemplateToVendor(vendorName: string, template: VendorTemplate): Promise<void> {
    try {
      const vendor = await prisma.vendor.findFirst({
        where: { name: { contains: vendorName, mode: 'insensitive' } },
      });

      if (vendor) {
        await prisma.vendor.update({
          where: { id: vendor.id },
          data: {
            invoice_template_type: 'CUSTOM' as any,
          },
        });
      }
    } catch (e) {
      // Non-critical — template is still returned
    }
  }

  private async getTemplate(vendorName: string): Promise<VendorTemplate | null> {
    // For now, generate on-the-fly from recent invoices
    // In production, this would be cached/stored in DB
    return await this.autoGenerateTemplate(vendorName);
  }
}

export const activeLearningService = ActiveLearningService.getInstance();
export const vendorTemplateService = VendorTemplateService.getInstance();
