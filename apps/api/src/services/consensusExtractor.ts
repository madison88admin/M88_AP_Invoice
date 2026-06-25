import { logger } from '../utils/logger';
import { NextGenService } from './nextGenService';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT' | 'MISSING';
export type DataSource = 'pdf2json' | 'gemini' | 'both' | 'none';

export interface FieldConsensus {
  value: any;
  confidence: ConfidenceLevel;
  source: DataSource;
  pdf2json_value?: any;
  gemini_value?: any;
  conflict_reason?: string;
}

export interface ConflictDetail {
  field: string;
  pdf2json_value: any;
  gemini_value: any;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  reason: string;
}

export interface ConsensusResult {
  vendor_name: FieldConsensus;
  invoice_number: FieldConsensus;
  invoice_date: FieldConsensus;
  due_date: FieldConsensus;
  payment_terms: FieldConsensus;
  total_amount: FieldConsensus;
  currency: FieldConsensus;
  po_number: FieldConsensus;
  mpo_number: FieldConsensus;
  brand: FieldConsensus;
  brand_code: FieldConsensus;
  season: FieldConsensus;
  line_items: FieldConsensus;

  overall_confidence: number;
  overall_status: 'APPROVED' | 'REVIEW_REQUIRED' | 'FAILED';
  requires_review: boolean;
  conflicts: ConflictDetail[];

  final: {
    vendor_name: string;
    invoice_number: string;
    invoice_date: string;
    due_date?: string | null;
    payment_terms?: string | null;
    total_amount: number;
    currency: string;
    po_number?: string;
    mpo_number?: string;
    brand?: string;
    brand_code?: string;
    season?: string;
    line_items: any[];
  };

  engines_used: string[];
  engine_notes: string;
  extraction_time_ms: number;
  extracted_at: Date;
}

export interface RawExtractionResult {
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
  line_items?: any[];
  confidence?: number;
  extraction_method?: string;
}

export class ConsensusExtractor {
  private static instance: ConsensusExtractor;

  static getInstance(): ConsensusExtractor {
    if (!ConsensusExtractor.instance) {
      ConsensusExtractor.instance = new ConsensusExtractor();
    }
    return ConsensusExtractor.instance;
  }

  async extract(
    rawText: string,
    pdfBuffer: Buffer,
    engine1: (text: string) => Promise<RawExtractionResult>,
    engine2: (text: string, buffer: Buffer) => Promise<RawExtractionResult | null>
  ): Promise<ConsensusResult> {
    const startTime = Date.now();
    const enginesUsed: string[] = [];
    let engineNotes = 'Dual-engine consensus extraction ready.';

    const [result1, result2] = await Promise.allSettled([
      engine1(rawText),
      engine2(rawText, pdfBuffer),
    ]);

    const pdf2jsonResult = result1.status === 'fulfilled' ? result1.value : null;
    const geminiResult = result2.status === 'fulfilled' ? result2.value : null;

    if (pdf2jsonResult) enginesUsed.push('pdf2json+madison');
    if (geminiResult) enginesUsed.push('gemini');

    if (result1.status === 'rejected') {
      logger.error('Engine 1 (pdf2json) failed:', result1.reason);
      engineNotes = 'pdf2json engine failed; extraction may be unreliable.';
    }
    if (result2.status === 'rejected') {
      logger.error('Engine 2 (gemini) failed:', result2.reason);
      engineNotes = 'Gemini engine failed; running single-engine consensus.';
    } else if (result2.status === 'fulfilled' && geminiResult === null) {
      engineNotes = 'Gemini unavailable (missing or invalid GEMINI_API_KEY); running single-engine consensus.';
    }

    if (enginesUsed.length === 1) {
      engineNotes += ' Enable GEMINI_API_KEY in apps/api/.env for dual-engine confidence.';
    }

    const conflicts: ConflictDetail[] = [];

    const vendor_name = this.compareVendorNames(
      'vendor_name',
      pdf2jsonResult?.vendor_name,
      geminiResult?.vendor_name,
      conflicts,
      'WARNING'
    );

    const invoice_number = this.compareExact(
      'invoice_number',
      pdf2jsonResult?.invoice_number,
      geminiResult?.invoice_number,
      conflicts,
      'CRITICAL'
    );

    const invoice_date = this.compareDates(
      'invoice_date',
      pdf2jsonResult?.invoice_date,
      geminiResult?.invoice_date,
      conflicts,
      rawText
    );

    const due_date = this.compareDates(
      'due_date',
      pdf2jsonResult?.due_date,
      geminiResult?.due_date,
      conflicts,
      rawText
    );

    const payment_terms = this.comparePaymentTerms(
      'payment_terms',
      pdf2jsonResult?.payment_terms,
      geminiResult?.payment_terms,
      conflicts,
      rawText
    );

    const total_amount = this.compareNumbers(
      'total_amount',
      pdf2jsonResult?.total_amount,
      geminiResult?.total_amount,
      conflicts,
      0
    );

    const currency = this.compareExact(
      'currency',
      pdf2jsonResult?.currency,
      geminiResult?.currency,
      conflicts,
      'WARNING'
    );

    const po_number = this.compareExact(
      'po_number',
      pdf2jsonResult?.po_number,
      geminiResult?.po_number,
      conflicts,
      'CRITICAL'
    );

    const mpo_number = this.compareExact(
      'mpo_number',
      pdf2jsonResult?.mpo_number,
      geminiResult?.mpo_number,
      conflicts,
      'CRITICAL'
    );

    const brand = this.compareBrandNames(
      'brand',
      pdf2jsonResult?.brand,
      geminiResult?.brand,
      conflicts,
      'INFO'
    );

    const brand_code = this.compareExact(
      'brand_code',
      pdf2jsonResult?.brand_code,
      geminiResult?.brand_code,
      conflicts,
      'INFO'
    );

    const season = this.compareExact(
      'season',
      pdf2jsonResult?.season,
      geminiResult?.season,
      conflicts,
      'INFO'
    );

    const line_items = this.compareLineItems(
      pdf2jsonResult?.line_items,
      geminiResult?.line_items,
      conflicts
    );

    const fieldNames = [
      'vendor_name', 'invoice_number', 'invoice_date', 'due_date',
      'payment_terms', 'total_amount', 'currency', 'po_number', 'mpo_number',
      'brand', 'brand_code', 'season', 'line_items'
    ];
    let fields = [
      vendor_name, invoice_number, invoice_date, due_date,
      payment_terms, total_amount, currency, po_number, mpo_number,
      brand, brand_code, season, line_items
    ];

    // NextGen tie-breaker: if engines conflict, resolve using NextGen PO data
    const mpoOrPo = po_number.value || mpo_number.value || pdf2jsonResult?.mpo_number || pdf2jsonResult?.po_number || geminiResult?.mpo_number || geminiResult?.po_number;
    if (conflicts.length > 0 && mpoOrPo) {
      const nextGenResolved = await this.resolveConflictsWithNextGen(
        conflicts,
        fields,
        fieldNames,
        {
          vendor_name: pdf2jsonResult?.vendor_name || geminiResult?.vendor_name,
          invoice_number: pdf2jsonResult?.invoice_number || geminiResult?.invoice_number,
          invoice_date: pdf2jsonResult?.invoice_date || geminiResult?.invoice_date,
          due_date: pdf2jsonResult?.due_date || geminiResult?.due_date,
          payment_terms: pdf2jsonResult?.payment_terms || geminiResult?.payment_terms,
          total_amount: pdf2jsonResult?.total_amount || geminiResult?.total_amount,
          currency: pdf2jsonResult?.currency || geminiResult?.currency,
          po_number: pdf2jsonResult?.po_number,
          mpo_number: pdf2jsonResult?.mpo_number || geminiResult?.mpo_number,
          brand: pdf2jsonResult?.brand,
          brand_code: pdf2jsonResult?.brand_code,
          season: pdf2jsonResult?.season,
        },
        {
          vendor_name: geminiResult?.vendor_name,
          invoice_number: geminiResult?.invoice_number,
          invoice_date: geminiResult?.invoice_date,
          due_date: geminiResult?.due_date,
          payment_terms: geminiResult?.payment_terms,
          total_amount: geminiResult?.total_amount,
          currency: geminiResult?.currency,
          po_number: geminiResult?.po_number,
          mpo_number: geminiResult?.mpo_number,
          brand: geminiResult?.brand,
          brand_code: geminiResult?.brand_code,
          season: geminiResult?.season,
        },
        mpoOrPo
      );

      if (nextGenResolved && nextGenResolved.fields.length > 0) {
        fields = nextGenResolved.fields;
        conflicts.splice(0, conflicts.length, ...nextGenResolved.remainingConflicts);
        logger.info(`NextGen resolved ${nextGenResolved.resolvedCount} conflicts for PO/MPO ${mpoOrPo}`);
      }
    }

    // Fallback: compute due_date from invoice_date + payment_terms if missing
    const invoiceDateValue = invoice_date.value;
    const paymentTermsValue = payment_terms.value;
    const dueDateValue = due_date.value;
    if (!dueDateValue && invoiceDateValue && paymentTermsValue) {
      const computedDueDate = this.computeDueDateFromTerms(invoiceDateValue, paymentTermsValue);
      if (computedDueDate) {
        due_date.value = computedDueDate;
        due_date.confidence = 'MEDIUM';
        due_date.source = 'both';
        fields[3] = due_date;
      }
    }

    const overallConfidence = this.calculateOverallConfidence(fields, conflicts);
    const requiresReview = conflicts.some(c => c.severity === 'CRITICAL') || overallConfidence < 60;
    const overallStatus = this.determineStatus(overallConfidence, conflicts);

    // Map resolved fields back to named variables for final result
    const resolvedVendorName = fields[0];
    const resolvedInvoiceNumber = fields[1];
    const resolvedInvoiceDate = fields[2];
    const resolvedDueDate = fields[3];
    const resolvedPaymentTerms = fields[4];
    const resolvedTotalAmount = fields[5];
    const resolvedCurrency = fields[6];
    const resolvedPoNumber = fields[7];
    const resolvedMpoNumber = fields[8];
    const resolvedBrand = fields[9];
    const resolvedBrandCode = fields[10];
    const resolvedSeason = fields[11];
    const resolvedLineItems = fields[12];

    const final = {
      vendor_name: resolvedVendorName.value || '',
      invoice_number: resolvedInvoiceNumber.value || '',
      invoice_date: resolvedInvoiceDate.value || '',
      due_date: resolvedDueDate.value || null,
      payment_terms: resolvedPaymentTerms.value || null,
      total_amount: resolvedTotalAmount.value || 0,
      currency: resolvedCurrency.value || 'USD',
      po_number: resolvedPoNumber.value,
      mpo_number: resolvedMpoNumber.value,
      brand: resolvedBrand.value,
      brand_code: resolvedBrandCode.value,
      season: resolvedSeason.value,
      line_items: resolvedLineItems.value || [],
    };

    const result: ConsensusResult = {
      vendor_name: resolvedVendorName,
      invoice_number: resolvedInvoiceNumber,
      invoice_date: resolvedInvoiceDate,
      due_date: resolvedDueDate,
      payment_terms: resolvedPaymentTerms,
      total_amount: resolvedTotalAmount,
      currency: resolvedCurrency,
      po_number: resolvedPoNumber,
      mpo_number: resolvedMpoNumber,
      brand: resolvedBrand,
      brand_code: resolvedBrandCode,
      season: resolvedSeason,
      line_items: resolvedLineItems,
      overall_confidence: overallConfidence,
      overall_status: overallStatus,
      requires_review: requiresReview,
      conflicts,
      final,
      engines_used: enginesUsed,
      engine_notes: engineNotes,
      extraction_time_ms: Date.now() - startTime,
      extracted_at: new Date(),
    };

    logger.info(`Consensus extraction complete: confidence=${overallConfidence}, status=${overallStatus}, conflicts=${conflicts.length}, engines=${enginesUsed.join('+')}`);

    return result;
  }

  private compareExact(
    field: string,
    val1: any,
    val2: any,
    conflicts: ConflictDetail[],
    conflictSeverity: 'CRITICAL' | 'WARNING' | 'INFO' = 'WARNING'
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: val1, confidence: 'MEDIUM', source: 'pdf2json', pdf2json_value: val1 };
    }
    if (!val1 && val2) {
      return { value: val2, confidence: 'MEDIUM', source: 'gemini', gemini_value: val2 };
    }

    const norm1 = String(val1).trim().toUpperCase();
    const norm2 = String(val2).trim().toUpperCase();

    if (norm1 === norm2) {
      return {
        value: val1,
        confidence: 'HIGH',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    conflicts.push({
      field,
      pdf2json_value: val1,
      gemini_value: val2,
      severity: conflictSeverity,
      reason: `${field} mismatch: "${val1}" vs "${val2}"`,
    });

    return {
      value: val1,
      confidence: 'CONFLICT',
      source: 'pdf2json',
      pdf2json_value: val1,
      gemini_value: val2,
      conflict_reason: `Engines disagree: "${val1}" vs "${val2}"`,
    };
  }

  private compareStrings(
    field: string,
    val1: string | undefined,
    val2: string | undefined,
    conflicts: ConflictDetail[],
    conflictSeverity: 'CRITICAL' | 'WARNING' | 'INFO' = 'WARNING'
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: val1, confidence: 'MEDIUM', source: 'pdf2json', pdf2json_value: val1 };
    }
    if (!val1 && val2) {
      return { value: val2, confidence: 'MEDIUM', source: 'gemini', gemini_value: val2 };
    }

    const norm1 = val1!.trim().toLowerCase();
    const norm2 = val2!.trim().toLowerCase();

    if (norm1 === norm2) {
      return { value: val1, confidence: 'HIGH', source: 'both', pdf2json_value: val1, gemini_value: val2 };
    }

    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const betterValue = val1!.length >= val2!.length ? val1 : val2;
      return {
        value: betterValue,
        confidence: 'MEDIUM',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    const words1 = norm1.split(/\s+/);
    const words2 = norm2.split(/\s+/);
    const overlap = words1.filter(w => words2.includes(w)).length;
    const overlapRatio = overlap / Math.max(words1.length, words2.length);

    if (overlapRatio > 0.5) {
      const betterValue = val1!.length >= val2!.length ? val1 : val2;
      return {
        value: betterValue,
        confidence: 'MEDIUM',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    conflicts.push({
      field,
      pdf2json_value: val1,
      gemini_value: val2,
      severity: conflictSeverity,
      reason: `${field} significantly different: "${val1}" vs "${val2}"`,
    });

    return {
      value: val1,
      confidence: 'CONFLICT',
      source: 'pdf2json',
      pdf2json_value: val1,
      gemini_value: val2,
      conflict_reason: `Engines disagree on ${field}`,
    };
  }

  private compareNumbers(
    field: string,
    val1: number | undefined,
    val2: number | undefined,
    conflicts: ConflictDetail[],
    tolerancePct: number = 0
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: val1, confidence: 'MEDIUM', source: 'pdf2json', pdf2json_value: val1 };
    }
    if (!val1 && val2) {
      return { value: val2, confidence: 'MEDIUM', source: 'gemini', gemini_value: val2 };
    }

    const maxVal = Math.max(val1!, val2!);
    const diff = maxVal > 0 ? Math.abs(val1! - val2!) / maxVal : 0;

    if (diff <= tolerancePct) {
      return {
        value: val1,
        confidence: 'HIGH',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    conflicts.push({
      field,
      pdf2json_value: val1,
      gemini_value: val2,
      severity: 'CRITICAL',
      reason: `${field} mismatch: ${val1} vs ${val2} (${(diff * 100).toFixed(2)}% difference)`,
    });

    return {
      value: val1,
      confidence: 'CONFLICT',
      source: 'pdf2json',
      pdf2json_value: val1,
      gemini_value: val2,
      conflict_reason: `Amount conflict: ${val1} vs ${val2}`,
    };
  }

  private compareDates(
    field: string,
    val1: string | undefined,
    val2: string | undefined,
    conflicts: ConflictDetail[],
    rawText?: string
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: val1, confidence: 'MEDIUM', source: 'pdf2json' };
    }
    if (!val1 && val2) {
      return { value: val2, confidence: 'MEDIUM', source: 'gemini' };
    }

    const norm1 = this.normalizeDate(val1!);
    const norm2 = this.normalizeDate(val2!);

    if (norm1 && norm2 && norm1 === norm2) {
      return { value: norm1, confidence: 'HIGH', source: 'both', pdf2json_value: val1, gemini_value: val2 };
    }

    if (norm1 && norm2 && norm1 !== norm2) {
      // If raw text is available, try to resolve using invoice date label
      const resolved = rawText ? this.resolveDateFromRawText(rawText, [norm1, norm2]) : null;
      if (resolved) {
        const source = resolved === norm1 ? 'pdf2json' : 'gemini';
        return {
          value: resolved,
          confidence: 'HIGH',
          source: 'both',
          pdf2json_value: val1,
          gemini_value: val2,
        };
      }

      conflicts.push({
        field,
        pdf2json_value: val1,
        gemini_value: val2,
        severity: 'WARNING',
        reason: `Date mismatch: "${val1}" vs "${val2}"`,
      });
      return {
        value: norm1,
        confidence: 'CONFLICT',
        source: 'pdf2json',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    return { value: norm1 || norm2, confidence: 'LOW', source: norm1 ? 'pdf2json' : 'gemini' };
  }

  private async resolveConflictsWithNextGen(
    conflicts: ConflictDetail[],
    fields: FieldConsensus[],
    fieldNames: string[],
    pdf2jsonResult: RawExtractionResult,
    geminiResult: RawExtractionResult,
    mpoOrPo: string
  ): Promise<{ fields: FieldConsensus[]; remainingConflicts: ConflictDetail[]; resolvedCount: number } | null> {
    try {
      const nextGenService = NextGenService.getInstance();
      const nextGenResult = await nextGenService.compareInvoiceWithPO({
        po_number: pdf2jsonResult.po_number || geminiResult.po_number,
        mpo_number: mpoOrPo?.startsWith('MPO') ? mpoOrPo : (pdf2jsonResult.mpo_number || geminiResult.mpo_number),
        amount: pdf2jsonResult.total_amount || geminiResult.total_amount || 0,
        vendor_name: pdf2jsonResult.vendor_name || geminiResult.vendor_name || '',
        brand: pdf2jsonResult.brand || geminiResult.brand,
        season: pdf2jsonResult.season || geminiResult.season,
        order_type: undefined,
      });

      if (!nextGenResult.po_found || !nextGenResult.nextgen_data) {
        return null;
      }

      const nextGenData = nextGenResult.nextgen_data;
      const resolvedFields = [...fields];
      const remainingConflicts: ConflictDetail[] = [];
      let resolvedCount = 0;

      for (const conflict of conflicts) {
        const fieldIndex = fieldNames.indexOf(conflict.field);
        const field = fieldIndex >= 0 ? resolvedFields[fieldIndex] : null;

        let resolved = false;

        if (conflict.field === 'brand' && nextGenData.brand) {
          const pdf2jsonBrand = pdf2jsonResult.brand;
          const geminiBrand = geminiResult.brand;
          const nextGenBrand = nextGenData.brand;
          const normalizedNextGen = this.normalizeBrandName(nextGenBrand);

          if (pdf2jsonBrand && this.normalizeBrandName(pdf2jsonBrand) === normalizedNextGen) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: pdf2jsonBrand,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonBrand,
              gemini_value: geminiBrand,
              conflict_reason: undefined,
            };
            resolved = true;
          } else if (geminiBrand && this.normalizeBrandName(geminiBrand) === normalizedNextGen) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: geminiBrand,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonBrand,
              gemini_value: geminiBrand,
              conflict_reason: undefined,
            };
            resolved = true;
          }
        }

        if (conflict.field === 'vendor_name' && nextGenData.vendor_name) {
          const pdf2jsonVendor = pdf2jsonResult.vendor_name;
          const geminiVendor = geminiResult.vendor_name;
          const nextGenVendor = nextGenData.vendor_name;
          const normalizedNextGen = this.normalizeVendorName(nextGenVendor);

          if (pdf2jsonVendor && this.normalizeVendorName(pdf2jsonVendor) === normalizedNextGen) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: pdf2jsonVendor,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonVendor,
              gemini_value: geminiVendor,
              conflict_reason: undefined,
            };
            resolved = true;
          } else if (geminiVendor && this.normalizeVendorName(geminiVendor) === normalizedNextGen) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: geminiVendor,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonVendor,
              gemini_value: geminiVendor,
              conflict_reason: undefined,
            };
            resolved = true;
          }
        }

        if (conflict.field === 'season' && nextGenData.season) {
          const pdf2jsonSeason = pdf2jsonResult.season;
          const geminiSeason = geminiResult.season;
          const nextGenSeason = nextGenData.season.toUpperCase();

          if (pdf2jsonSeason && pdf2jsonSeason.toUpperCase() === nextGenSeason) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: pdf2jsonSeason,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonSeason,
              gemini_value: geminiSeason,
              conflict_reason: undefined,
            };
            resolved = true;
          } else if (geminiSeason && geminiSeason.toUpperCase() === nextGenSeason) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: geminiSeason,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonSeason,
              gemini_value: geminiSeason,
              conflict_reason: undefined,
            };
            resolved = true;
          }
        }

        if (conflict.field === 'invoice_date' && nextGenData.order_date) {
          const pdf2jsonDate = this.normalizeDate(pdf2jsonResult.invoice_date || '');
          const geminiDate = this.normalizeDate(geminiResult.invoice_date || '');
          const nextGenDate = this.normalizeDate(nextGenData.order_date.toString());

          if (pdf2jsonDate && nextGenDate && pdf2jsonDate === nextGenDate) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: pdf2jsonDate,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonResult.invoice_date,
              gemini_value: geminiResult.invoice_date,
              conflict_reason: undefined,
            };
            resolved = true;
          } else if (geminiDate && nextGenDate && geminiDate === nextGenDate) {
            resolvedFields[fieldIndex] = {
              ...field!,
              value: geminiDate,
              confidence: 'HIGH',
              source: 'both',
              pdf2json_value: pdf2jsonResult.invoice_date,
              gemini_value: geminiResult.invoice_date,
              conflict_reason: undefined,
            };
            resolved = true;
          }
        }

        if (!resolved) {
          remainingConflicts.push(conflict);
        } else {
          resolvedCount++;
        }
      }

      return { fields: resolvedFields, remainingConflicts, resolvedCount };
    } catch (error) {
      logger.error('NextGen conflict resolution failed:', error);
      return null;
    }
  }

  private compareVendorNames(
    field: string,
    val1: string | undefined,
    val2: string | undefined,
    conflicts: ConflictDetail[],
    conflictSeverity: 'CRITICAL' | 'WARNING' | 'INFO' = 'WARNING'
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: this.cleanVendorNoise(val1), confidence: 'MEDIUM', source: 'pdf2json', pdf2json_value: val1 };
    }
    if (!val1 && val2) {
      return { value: this.cleanVendorNoise(val2), confidence: 'MEDIUM', source: 'gemini', gemini_value: val2 };
    }

    const cleaned1 = this.cleanVendorNoise(val1!);
    const cleaned2 = this.cleanVendorNoise(val2!);
    const norm1 = this.normalizeVendorName(val1!);
    const norm2 = this.normalizeVendorName(val2!);

    if (norm1 === norm2) {
      const betterValue = cleaned1.length >= cleaned2.length ? cleaned1 : cleaned2;
      return {
        value: betterValue,
        confidence: 'HIGH',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    // Substring fallback after normalization
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const betterValue = cleaned1.length >= cleaned2.length ? cleaned1 : cleaned2;
      return {
        value: betterValue,
        confidence: 'HIGH',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    conflicts.push({
      field,
      pdf2json_value: val1,
      gemini_value: val2,
      severity: conflictSeverity,
      reason: `${field} mismatch: "${val1}" vs "${val2}"`,
    });

    return {
      value: val1,
      confidence: 'CONFLICT',
      source: 'pdf2json',
      pdf2json_value: val1,
      gemini_value: val2,
      conflict_reason: `Engines disagree on ${field}`,
    };
  }

  private compareBrandNames(
    field: string,
    val1: string | undefined,
    val2: string | undefined,
    conflicts: ConflictDetail[],
    conflictSeverity: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO'
  ): FieldConsensus {
    if (!val1 && !val2) {
      return { value: null, confidence: 'MISSING', source: 'none' };
    }
    if (val1 && !val2) {
      return { value: val1, confidence: 'MEDIUM', source: 'pdf2json', pdf2json_value: val1 };
    }
    if (!val1 && val2) {
      return { value: val2, confidence: 'MEDIUM', source: 'gemini', gemini_value: val2 };
    }

    const norm1 = this.normalizeBrandName(val1!);
    const norm2 = this.normalizeBrandName(val2!);

    if (norm1 === norm2) {
      const betterValue = val1!.length >= val2!.length ? val1 : val2;
      return {
        value: betterValue,
        confidence: 'HIGH',
        source: 'both',
        pdf2json_value: val1,
        gemini_value: val2,
      };
    }

    conflicts.push({
      field,
      pdf2json_value: val1,
      gemini_value: val2,
      severity: conflictSeverity,
      reason: `${field} mismatch: "${val1}" vs "${val2}"`,
    });

    return {
      value: val1,
      confidence: 'CONFLICT',
      source: 'pdf2json',
      pdf2json_value: val1,
      gemini_value: val2,
      conflict_reason: `Engines disagree on ${field}`,
    };
  }

  private normalizeVendorName(name: string): string {
    return this.cleanVendorNoise(name)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\b(CO|LTD|LLC|INC|CORPORATION|CORP|COMPANY|LIMITED|LTD|BV|SA|SRL|GMBH|PTE)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanVendorNoise(name: string): string {
    const noisePrefixes = [
      /^\s*Sales Invoice\s+Invoice\s+No\s*/i,
      /^\s*Invoice\s+No\s*/i,
      /^\s*Sales Invoice\s*/i,
      /^\s*Invoice\s*/i,
      /^\s*Bill\s+To\s*[:\-]?\s*/i,
      /^\s*Ship\s+To\s*[:\-]?\s*/i,
      /^\s*Sold\s+To\s*[:\-]?\s*/i,
    ];
    let cleaned = name;
    for (const prefix of noisePrefixes) {
      cleaned = cleaned.replace(prefix, '');
    }
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  private comparePaymentTerms(
    field: string,
    val1: string | undefined,
    val2: string | undefined,
    conflicts: ConflictDetail[],
    rawText?: string
  ): FieldConsensus {
    // Clean up known label noise before comparison
    const cleanLabel = (v: string | undefined): string | undefined => {
      if (!v) return v;
      const cleaned = v.replace(/\b(Payment\s+Terms?|Due\s+Date|Terms?)\b/gi, '').trim();
      return cleaned || v;
    };

    const clean1 = cleanLabel(val1);
    const clean2 = cleanLabel(val2);

    // If both engines just return labels, or no value, try raw text patterns
    const hasRealTerms = (v: string | undefined): boolean => {
      if (!v) return false;
      const normalized = v.toLowerCase();
      return /\d+\s*days?|net\s*\d+|cod|prepaid|immediate|upon\s*receipt|eom|n\/\d+|due\s*in/i.test(normalized);
    };

    if (!hasRealTerms(clean1) && !hasRealTerms(clean2) && rawText) {
      const rawTerms = this.extractPaymentTermsFromRawText(rawText);
      if (rawTerms) {
        return {
          value: rawTerms,
          confidence: 'MEDIUM',
          source: rawText ? 'both' : 'none',
          pdf2json_value: val1,
          gemini_value: val2,
        };
      }
    }

    return this.compareStrings(field, clean1, clean2, conflicts, 'INFO');
  }

  private computeDueDateFromTerms(invoiceDate: string, paymentTerms: string): string | null {
    const normalizedDate = this.normalizeDate(invoiceDate);
    if (!normalizedDate) return null;

    const daysMatch = paymentTerms.match(/(\d{1,3})\s*days?/i);
    const netMatch = paymentTerms.match(/net\s*(\d{1,3})/i);
    const days = daysMatch ? parseInt(daysMatch[1]) : (netMatch ? parseInt(netMatch[1]) : null);

    if (!days || isNaN(days)) return null;

    const date = new Date(normalizedDate);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  private extractPaymentTermsFromRawText(rawText: string): string | null {
    const patterns = [
      /(?:payment\s*terms?[:\s]*)?(\d{1,3}\s*days?)/i,
      /(?:payment\s*terms?[:\s]*)?(net\s*\d{1,3})/i,
      /(?:payment\s*terms?[:\s]*)?(cod|prepaid|immediate|upon\s*receipt)/i,
      /(?:payment\s*terms?[:\s]*)?(eom|n\/\d{1,3})/i,
      /due\s*in\s*(\d{1,3}\s*days?)/i,
    ];
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  }

  private normalizeBrandName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  private resolveDateFromRawText(rawText: string, candidates: string[]): string | null {
    const upperText = rawText.toUpperCase();
    const dateLabels = [
      'INVOICE DATE',
      'INVOICE DATE:',
      'INV DATE',
      'DATE OF INVOICE',
      'BILLING DATE',
    ];

    for (const label of dateLabels) {
      const idx = upperText.indexOf(label);
      if (idx === -1) continue;

      const snippet = rawText.substring(idx, idx + 120);
      const normalized = this.normalizeDate(snippet);
      if (normalized && candidates.includes(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private compareLineItems(
    items1: any[] | undefined,
    items2: any[] | undefined,
    conflicts: ConflictDetail[]
  ): FieldConsensus {
    if (!items1?.length && !items2?.length) {
      return { value: [], confidence: 'MISSING', source: 'none' };
    }
    if (items1?.length && !items2?.length) {
      return { value: items1, confidence: 'MEDIUM', source: 'pdf2json' };
    }
    if (!items1?.length && items2?.length) {
      return { value: items2, confidence: 'MEDIUM', source: 'gemini' };
    }

    if (items1!.length !== items2!.length) {
      conflicts.push({
        field: 'line_items',
        pdf2json_value: `${items1!.length} items`,
        gemini_value: `${items2!.length} items`,
        severity: 'WARNING',
        reason: `Line item count mismatch: ${items1!.length} vs ${items2!.length}`,
      });
      const betterItems = items1!.length >= items2!.length ? items1 : items2;
      return {
        value: betterItems,
        confidence: 'MEDIUM',
        source: items1!.length >= items2!.length ? 'pdf2json' : 'gemini',
        pdf2json_value: items1,
        gemini_value: items2,
      };
    }

    const total1 = items1!.reduce((sum, li) => sum + (li.total_amount || 0), 0);
    const total2 = items2!.reduce((sum, li) => sum + (li.total_amount || 0), 0);
    const diff = Math.abs(total1 - total2);

    if (diff < 0.01) {
      return { value: items1, confidence: 'HIGH', source: 'both' };
    }

    conflicts.push({
      field: 'line_items_total',
      pdf2json_value: total1,
      gemini_value: total2,
      severity: 'WARNING',
      reason: `Line items total mismatch: ${total1} vs ${total2}`,
    });

    return {
      value: items1,
      confidence: 'MEDIUM',
      source: 'pdf2json',
      pdf2json_value: items1,
      gemini_value: items2,
    };
  }

  private normalizeDate(dateStr: string): string | null {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }

      const months: Record<string, string> = {
        JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06',
        JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12'
      };
      const match = dateStr.match(/(\d{1,2})-([A-Z]{3})-(\d{4})/i);
      if (match) {
        const [, day, mon, year] = match;
        const month = months[mon.toUpperCase()];
        if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  private calculateOverallConfidence(
    fields: FieldConsensus[],
    conflicts: ConflictDetail[]
  ): number {
    const weights: Record<ConfidenceLevel, number> = {
      HIGH: 100,
      MEDIUM: 65,
      LOW: 30,
      CONFLICT: 20,
      MISSING: 0,
    };

    const avg = fields.reduce((sum, f) => sum + weights[f.confidence], 0) / fields.length;

    const criticalCount = conflicts.filter(c => c.severity === 'CRITICAL').length;
    const warningCount = conflicts.filter(c => c.severity === 'WARNING').length;

    const penalty = (criticalCount * 20) + (warningCount * 5);
    return Math.max(0, Math.round(avg - penalty));
  }

  private determineStatus(
    confidence: number,
    conflicts: ConflictDetail[]
  ): 'APPROVED' | 'REVIEW_REQUIRED' | 'FAILED' {
    const hasCritical = conflicts.some(c => c.severity === 'CRITICAL');
    if (hasCritical) return 'REVIEW_REQUIRED';
    if (confidence >= 80) return 'APPROVED';
    if (confidence >= 50) return 'REVIEW_REQUIRED';
    return 'FAILED';
  }
}

export const consensusExtractor = ConsensusExtractor.getInstance();
