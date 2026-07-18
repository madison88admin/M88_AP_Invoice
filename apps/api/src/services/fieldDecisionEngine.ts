import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';
import { AST_SINGLE_SOURCE_MODE } from './extractors/constants';
import {
  calibrateExtractionConfidence,
  getExtractionFieldPolicy,
  requiresExtractionReview,
} from './extractionPolicyService';

// ============================================================================
// TYPES
// ============================================================================

export type EngineName = 'madison' | 'gemini' | 'qwen' | 'groq' | 'ollama' | 'vendor_rules' | 'nextgen' | 'structured';

export interface FieldCandidate {
  value: any;
  engine: EngineName;
  confidence: number; // 0-100
  evidence?: FieldEvidence;
}

export interface FieldEvidence {
  page?: number;
  line?: number;
  bounding_box?: { x: number; y: number; width: number; height: number };
  matched_label?: string;
  matched_regex?: string;
  raw_text_snippet?: string;
  ai_confidence?: number;
}

export interface ConfidenceBreakdown {
  base: number;
  consensus_bonus: number;
  vendor_rule_bonus: number;
  nextgen_match_bonus: number;
  learned_rule_bonus: number;
  total: number;
}

export interface FieldProvenance {
  chosen_engine: EngineName;
  chosen_value: any;
  other_candidates: Array<{
    engine: EngineName;
    value: any;
    confidence: number;
  }>;
  selection_reason: string;
}

export interface FieldDecision {
  field: string;
  final_value: any;
  final_confidence: number; // 0-100
  confidence_breakdown: ConfidenceBreakdown;
  selected_engine: EngineName;
  candidates: FieldCandidate[];
  provenance: FieldProvenance;
  conflict: boolean;
  conflict_reason?: string;
  evidence: FieldEvidence;
  review_required: boolean;
}

export interface DecisionResult {
  fields: Record<string, FieldDecision>;
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
    ship_to?: string;
    sold_to?: string;
    line_items: LineItemDecision[];
  };
  overall_confidence: number;
  overall_status: 'APPROVED' | 'REVIEW_REQUIRED' | 'FAILED';
  requires_review: boolean;
  review_fields: string[];
  conflicts: Array<{ field: string; reason: string; severity: 'CRITICAL' | 'WARNING' | 'INFO' }>;
  engines_used: EngineName[];
  engine_notes: string;
  extraction_time_ms: number;
  extracted_at: Date;
}

export interface LineItemDecision {
  line_number: number;
  description?: string | null;
  mpo_base_number?: string | null;
  mpo_order_sequence?: string | null;
  material_code?: string | null;
  material_name?: string | null;
  quantity?: number | null;
  selling_quantity?: number | null;
  unit_price?: number | null;
  line_amount?: number | null;
  total_amount?: number | null;
  extraction_confidence: number;
  review_required: boolean;
  field_confidence: Record<string, FieldDecision>;
  extraction_provenance: Record<string, FieldProvenance>;
  source_evidence: Record<string, FieldEvidence>;
  arithmetic_validation: {
    passed: boolean;
    expected_amount: number | null;
    difference: number | null;
  };
}

interface EngineOutput {
  engine_name: EngineName;
  data: Record<string, any>;
  confidence: number;
}

// ============================================================================
// STRUCTURED LEARNING RULES
// ============================================================================

export interface StructuredLearningRule {
  vendor: string;
  field: string;
  wrong_value: string;
  correct_value: string;
  reason: string;
  use_count: number;
  created_at: Date;
}

// ============================================================================
// FIELD DECISION ENGINE — SINGLE SOURCE OF TRUTH
// ============================================================================

export class FieldDecisionEngine {
  private static instance: FieldDecisionEngine;

  static getInstance(): FieldDecisionEngine {
    if (!FieldDecisionEngine.instance) {
      FieldDecisionEngine.instance = new FieldDecisionEngine();
    }
    return FieldDecisionEngine.instance;
  }

  async decide(
    engines: EngineOutput[],
    options?: {
      vendorName?: string;
      nextGenData?: Record<string, any>;
      rawText?: string;
    }
  ): Promise<DecisionResult> {
    const startTime = Date.now();
    const fields: Record<string, FieldDecision> = {};
    const conflicts: DecisionResult['conflicts'] = [];
    const enginesUsed = engines.map(e => e.engine_name);

    const learnedRules = await this.getLearnedRules(options?.vendorName);

    const fieldNames = [
      'vendor_name', 'invoice_number', 'invoice_date', 'due_date',
      'payment_terms', 'total_amount', 'currency', 'po_number',
      'mpo_number', 'brand', 'brand_code', 'season', 'ship_to', 'sold_to',
    ];

    for (const fieldName of fieldNames) {
      const candidates: FieldCandidate[] = [];

      for (const engine of engines) {
        const value = engine.data[fieldName];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
          candidates.push({
            value,
            engine: engine.engine_name,
            confidence: this.calculateFieldConfidence(fieldName, value, engine.engine_name, engine.confidence),
            evidence: this.extractEvidence(fieldName, value, options?.rawText),
          });
        }
      }

      if (candidates.length === 0) {
        fields[fieldName] = {
          field: fieldName,
          final_value: null,
          final_confidence: 0,
          confidence_breakdown: { base: 0, consensus_bonus: 0, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 0, total: 0 },
          selected_engine: 'madison',
          candidates: [],
          provenance: {
            chosen_engine: 'madison',
            chosen_value: null,
            other_candidates: [],
            selection_reason: 'No engine produced a value',
          },
          conflict: false,
          evidence: {},
          review_required: true,
        };
        conflicts.push({ field: fieldName, reason: 'No engine produced a value', severity: 'WARNING' });
        continue;
      }

      const learnedOverride = this.applyLearnedRules(fieldName, candidates, learnedRules);
      const decision = this.selectBestCandidate(fieldName, candidates, options?.nextGenData, learnedOverride);
      fields[fieldName] = this.applyConfidencePolicy(fieldName, decision);

      if (fields[fieldName].conflict) {
        conflicts.push({
          field: fieldName,
          reason: fields[fieldName].conflict_reason || 'Conflict between engines',
          severity: this.getConflictSeverity(fieldName),
        });
      }
    }

    // Compute due_date from invoice_date + payment_terms if missing
    const invoiceDateField = fields['invoice_date'];
    const paymentTermsField = fields['payment_terms'];
    const dueDateField = fields['due_date'];
    if ((!dueDateField.final_value || dueDateField.final_confidence === 0) &&
        invoiceDateField.final_value && paymentTermsField.final_value) {
      const computedDueDate = this.computeDueDateFromTerms(
        String(invoiceDateField.final_value),
        String(paymentTermsField.final_value)
      );
      if (computedDueDate) {
        fields['due_date'] = {
          ...dueDateField,
          final_value: computedDueDate,
          final_confidence: 70,
          confidence_breakdown: { ...dueDateField.confidence_breakdown, base: 70, total: 70 },
          selected_engine: 'madison',
          provenance: {
            ...dueDateField.provenance,
            chosen_engine: 'madison',
            chosen_value: computedDueDate,
            selection_reason: 'Computed from invoice_date + payment_terms',
          },
          review_required: false,
        };
      }
    }

    // Line items — pick the best set from any engine
    const lineItems = this.selectLineItems(engines);

    // Overall confidence
    const fieldConfidences = Object.values(fields).map(f => f.final_confidence);
    const overallConfidence = fieldConfidences.length > 0
      ? Math.round(fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length)
      : 0;

    const reviewFields = Object.values(fields).filter(f => f.review_required).map(f => f.field);

    const overallStatus: DecisionResult['overall_status'] =
      overallConfidence >= 80 && conflicts.filter(c => c.severity === 'CRITICAL').length === 0
        ? 'APPROVED'
        : overallConfidence < 30
        ? 'FAILED'
        : 'REVIEW_REQUIRED';

    const engineNotes = enginesUsed.length === 1
      ? `Single engine: ${enginesUsed[0]}. Add GEMINI_API_KEY and DASHSCOPE_API_KEY for multi-engine consensus.`
      : `Multi-engine decision: ${enginesUsed.join(' + ')}`;

    const final: DecisionResult['final'] = {
      vendor_name: String(fields['vendor_name']?.final_value || ''),
      invoice_number: String(fields['invoice_number']?.final_value || ''),
      invoice_date: String(fields['invoice_date']?.final_value || ''),
      due_date: fields['due_date']?.final_value || null,
      payment_terms: fields['payment_terms']?.final_value || null,
      total_amount: Number(fields['total_amount']?.final_value || 0),
      currency: String(fields['currency']?.final_value || 'USD'),
      po_number: fields['po_number']?.final_value || undefined,
      mpo_number: fields['mpo_number']?.final_value || undefined,
      brand: fields['brand']?.final_value || undefined,
      brand_code: fields['brand_code']?.final_value || undefined,
      season: fields['season']?.final_value || undefined,
      ship_to: fields['ship_to']?.final_value || undefined,
      sold_to: fields['sold_to']?.final_value || undefined,
      line_items: lineItems,
    };

    const result: DecisionResult = {
      fields,
      final,
      overall_confidence: overallConfidence,
      overall_status: overallStatus,
      requires_review: reviewFields.length > 0 || overallConfidence < 60,
      review_fields: reviewFields,
      conflicts,
      engines_used: enginesUsed,
      engine_notes: engineNotes,
      extraction_time_ms: Date.now() - startTime,
      extracted_at: new Date(),
    };

    logger.info(
      `[FieldDecisionEngine] Decided ${fieldNames.length} fields from ${engines.length} engines: ` +
      `confidence=${overallConfidence}, status=${overallStatus}, conflicts=${conflicts.length}, review_fields=${reviewFields.length}`
    );

    return result;
  }

  // ============================================================================
  // CANDIDATE SELECTION WITH EXPLAINABLE CONFIDENCE
  // ============================================================================

  private selectBestCandidate(
    fieldName: string,
    candidates: FieldCandidate[],
    nextGenData?: Record<string, any>,
    learnedOverride?: FieldCandidate | null
  ): FieldDecision {
    if (learnedOverride) {
      return {
        field: fieldName,
        final_value: learnedOverride.value,
        final_confidence: 95,
        confidence_breakdown: { base: 80, consensus_bonus: 0, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 15, total: 95 },
        selected_engine: 'vendor_rules',
        candidates,
        provenance: {
          chosen_engine: 'vendor_rules',
          chosen_value: learnedOverride.value,
          other_candidates: candidates.map(c => ({ engine: c.engine, value: c.value, confidence: c.confidence })),
          selection_reason: `Learned correction: ${learnedOverride.evidence?.matched_label || 'vendor rule'}`,
        },
        conflict: false,
        evidence: learnedOverride.evidence || {},
        review_required: false,
      };
    }

    if (candidates.length === 1) {
      const c = candidates[0];
      return {
        field: fieldName,
        final_value: c.value,
        final_confidence: c.confidence,
        confidence_breakdown: { base: c.confidence, consensus_bonus: 0, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 0, total: c.confidence },
        selected_engine: c.engine,
        candidates,
        provenance: { chosen_engine: c.engine, chosen_value: c.value, other_candidates: [], selection_reason: 'Single engine' },
        conflict: false,
        evidence: c.evidence || {},
        review_required: c.confidence < 60,
      };
    }

    const normalizedValues = candidates.map(c => this.normalizeForComparison(fieldName, c.value));
    const allAgree = normalizedValues.every(v => v === normalizedValues[0]);

    if (allAgree) {
      const best = candidates.reduce((a, b) => b.confidence > a.confidence ? b : a);
      const bonus = 10;
      const total = Math.min(100, best.confidence + bonus);
      return {
        field: fieldName,
        final_value: best.value,
        final_confidence: total,
        confidence_breakdown: { base: best.confidence, consensus_bonus: bonus, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 0, total },
        selected_engine: best.engine,
        candidates,
        provenance: {
          chosen_engine: best.engine,
          chosen_value: best.value,
          other_candidates: candidates.filter(c => c !== best).map(c => ({ engine: c.engine, value: c.value, confidence: c.confidence })),
          selection_reason: `All ${candidates.length} engines agree (+${bonus})`,
        },
        conflict: false,
        evidence: best.evidence || {},
        review_required: false,
      };
    }

    if (candidates.length >= 3) {
      const valueGroups = new Map<string, FieldCandidate[]>();
      for (const c of candidates) {
        const key = this.normalizeForComparison(fieldName, c.value);
        if (!valueGroups.has(key)) valueGroups.set(key, []);
        valueGroups.get(key)!.push(c);
      }
      let majorityGroup: FieldCandidate[] | null = null;
      for (const group of valueGroups.values()) {
        if (group.length > candidates.length / 2) { majorityGroup = group; break; }
      }
      if (majorityGroup) {
        const best = majorityGroup.reduce((a, b) => b.confidence > a.confidence ? b : a);
        const bonus = 5;
        const total = Math.min(100, best.confidence + bonus);
        return {
          field: fieldName,
          final_value: best.value,
          final_confidence: total,
          confidence_breakdown: { base: best.confidence, consensus_bonus: bonus, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 0, total },
          selected_engine: best.engine,
          candidates,
          provenance: {
            chosen_engine: best.engine,
            chosen_value: best.value,
            other_candidates: candidates.filter(c => c !== best).map(c => ({ engine: c.engine, value: c.value, confidence: c.confidence })),
            selection_reason: `Majority (${majorityGroup.length}/${candidates.length}) (+${bonus})`,
          },
          conflict: false,
          evidence: best.evidence || {},
          review_required: best.confidence < 70,
        };
      }
    }

    // NextGen tie-breaker
    if (nextGenData) {
      const nextGenValue = nextGenData[fieldName];
      if (nextGenValue) {
        const nextGenNormalized = this.normalizeForComparison(fieldName, nextGenValue);
        const matchingCandidate = candidates.find(c => this.normalizeForComparison(fieldName, c.value) === nextGenNormalized);
        if (matchingCandidate) {
          const bonus = 15;
          const total = Math.min(100, matchingCandidate.confidence + bonus);
          return {
            field: fieldName,
            final_value: matchingCandidate.value,
            final_confidence: total,
            confidence_breakdown: { base: matchingCandidate.confidence, consensus_bonus: 0, vendor_rule_bonus: 0, nextgen_match_bonus: bonus, learned_rule_bonus: 0, total },
            selected_engine: matchingCandidate.engine,
            candidates,
            provenance: {
              chosen_engine: matchingCandidate.engine,
              chosen_value: matchingCandidate.value,
              other_candidates: candidates.filter(c => c !== matchingCandidate).map(c => ({ engine: c.engine, value: c.value, confidence: c.confidence })),
              selection_reason: `NextGen match (+${bonus})`,
            },
            conflict: false,
            conflict_reason: 'Resolved by NextGen',
            evidence: matchingCandidate.evidence || {},
            review_required: false,
          };
        }
      }
    }

    // Unresolved conflict
    let best: FieldCandidate;
    if (AST_SINGLE_SOURCE_MODE) {
      const madisonCandidate = candidates.find(c => c.engine === 'madison');
      best = madisonCandidate || candidates.reduce((a, b) => b.confidence > a.confidence ? b : a);
    } else {
      best = candidates.reduce((a, b) => b.confidence > a.confidence ? b : a);
    }

    return {
      field: fieldName,
      final_value: best.value,
      final_confidence: best.confidence,
      confidence_breakdown: { base: best.confidence, consensus_bonus: 0, vendor_rule_bonus: 0, nextgen_match_bonus: 0, learned_rule_bonus: 0, total: best.confidence },
      selected_engine: best.engine,
      candidates,
      provenance: {
        chosen_engine: best.engine,
        chosen_value: best.value,
        other_candidates: candidates.filter(c => c !== best).map(c => ({ engine: c.engine, value: c.value, confidence: c.confidence })),
        selection_reason: AST_SINGLE_SOURCE_MODE ? 'AST mode — Madison preferred' : 'Highest confidence',
      },
      conflict: true,
      conflict_reason: `Engines disagree: ${candidates.map(c => `${c.engine}=${c.value}`).join(', ')}`,
      evidence: best.evidence || {},
      review_required: true,
    };
  }

  // ============================================================================
  // LINE ITEM SELECTION
  // ============================================================================

  private selectLineItems(engines: EngineOutput[]): LineItemDecision[] {
    const lineFields = [
      'description', 'mpo_base_number', 'mpo_order_sequence', 'material_code',
      'material_name', 'quantity', 'selling_quantity', 'unit_price', 'line_amount',
    ];
    const buckets: Array<Array<{ engine: EngineOutput; line: any; index: number }>> = [];

    for (const engine of engines) {
      const engineLines = Array.isArray(engine.data?.line_items) ? engine.data.line_items : [];
      engineLines.forEach((rawLine: any, index: number) => {
        const line = this.normalizeLineItem(rawLine, index);
        const identity = this.lineIdentity(line);
        let bucket = buckets.find(group => {
          const candidate = group[0]?.line;
          const candidateIdentity = this.lineIdentity(candidate);
          return identity && candidateIdentity
            ? identity === candidateIdentity
            : group[0]?.index === index;
        });
        if (!bucket) {
          bucket = [];
          buckets.push(bucket);
        }
        bucket.push({ engine, line, index });
      });
    }

    return buckets.map((bucket, bucketIndex) => {
      const fieldConfidence: Record<string, FieldDecision> = {};
      for (const field of lineFields) {
        const candidates: FieldCandidate[] = bucket
          .map(({ engine, line }) => {
            const value = line[field];
            if (value === null || value === undefined || String(value).trim() === '') return null;
            const suppliedConfidence = Number(
              line.field_confidence?.[field]?.confidence ??
              line.field_confidence?.[field] ??
              line.confidence ??
              engine.confidence
            );
            return {
              value,
              engine: engine.engine_name,
              confidence: this.calculateFieldConfidence(`line_items.${field}`, value, engine.engine_name, suppliedConfidence),
              evidence: line.source_evidence?.[field] || line.evidence?.[field] || {},
            } as FieldCandidate;
          })
          .filter((candidate): candidate is FieldCandidate => candidate !== null);

        if (candidates.length === 0) continue;
        fieldConfidence[field] = this.applyConfidencePolicy(
          `line_items.${field}`,
          this.selectBestCandidate(`line_items.${field}`, candidates)
        );
      }

      const value = (field: string) => fieldConfidence[field]?.final_value ?? null;
      const quantity = this.toNumberOrNull(value('quantity'));
      const unitPrice = this.toNumberOrNull(value('unit_price'));
      const lineAmount = this.toNumberOrNull(value('line_amount'));
      const expectedAmount = quantity != null && unitPrice != null ? quantity * unitPrice : null;
      const difference = expectedAmount != null && lineAmount != null ? Math.abs(expectedAmount - lineAmount) : null;
      const arithmeticPassed = difference != null && expectedAmount != null
        ? difference <= Math.max(0.01, Math.abs(expectedAmount) * 0.005)
        : false;

      for (const field of ['quantity', 'unit_price', 'line_amount']) {
        const decision = fieldConfidence[field];
        if (!decision) continue;
        decision.final_confidence = calibrateExtractionConfidence({
          field,
          raw_confidence: decision.final_confidence,
          source_count: decision.candidates.length,
          consensus_count: this.consensusCount(field, decision),
          arithmetic_validated: arithmeticPassed,
        });
        decision.confidence_breakdown.total = decision.final_confidence;
        decision.review_required = requiresExtractionReview(field, decision.final_confidence);
      }

      const decisions = Object.values(fieldConfidence);
      const confidence = decisions.length
        ? Math.round(decisions.reduce((sum, decision) => sum + decision.final_confidence, 0) / decisions.length)
        : 0;

      return {
        line_number: Number(value('line_number') || bucket[0]?.line?.line_number || bucketIndex + 1),
        description: value('description'),
        mpo_base_number: value('mpo_base_number'),
        mpo_order_sequence: value('mpo_order_sequence'),
        material_code: value('material_code'),
        material_name: value('material_name'),
        quantity,
        selling_quantity: this.toNumberOrNull(value('selling_quantity')),
        unit_price: unitPrice,
        line_amount: lineAmount,
        total_amount: lineAmount,
        extraction_confidence: confidence,
        review_required: decisions.some(decision => decision.review_required) || !arithmeticPassed,
        field_confidence: fieldConfidence,
        extraction_provenance: Object.fromEntries(
          Object.entries(fieldConfidence).map(([field, decision]) => [field, decision.provenance])
        ),
        source_evidence: Object.fromEntries(
          Object.entries(fieldConfidence).map(([field, decision]) => [field, decision.evidence])
        ),
        arithmetic_validation: {
          passed: arithmeticPassed,
          expected_amount: expectedAmount,
          difference,
        },
      };
    });
  }

  private normalizeLineItem(line: any, index: number) {
    return {
      ...line,
      line_number: Number(line.line_number || index + 1),
      description: line.description || line.item_description || line.material_name || null,
      mpo_base_number: line.mpo_base_number || line.mpo_number || null,
      mpo_order_sequence: line.mpo_order_sequence || line.order_sequence || null,
      material_code: line.material_code || line.item_code || line.sku || null,
      material_name: line.material_name || line.item_name || line.description || null,
      quantity: line.quantity ?? line.qty ?? null,
      selling_quantity: line.selling_quantity ?? line.sell_qty ?? null,
      unit_price: line.unit_price ?? line.price ?? null,
      line_amount: line.line_amount ?? line.total_amount ?? line.amount ?? null,
    };
  }

  private lineIdentity(line: any): string {
    const material = String(line?.material_code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const mpo = String(line?.mpo_base_number || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const sequence = String(line?.mpo_order_sequence || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const lineNumber = Number(line?.line_number || 0);
    if (material) return `${mpo}|${sequence}|${material}|${lineNumber}`;
    if (mpo && sequence) return `${mpo}|${sequence}|${lineNumber}`;
    return '';
  }

  private toNumberOrNull(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  // ============================================================================
  // CONFIDENCE CALCULATION
  // ============================================================================

  private applyConfidencePolicy(field: string, decision: FieldDecision): FieldDecision {
    const externallyValidated = ['nextgen', 'structured'].includes(decision.selected_engine) || decision.confidence_breakdown.nextgen_match_bonus > 0;
    const confidence = calibrateExtractionConfidence({
      field,
      raw_confidence: decision.final_confidence,
      source_count: decision.candidates.length || 1,
      consensus_count: this.consensusCount(field, decision),
      externally_validated: externallyValidated,
    });
    const policy = getExtractionFieldPolicy(field);
    return {
      ...decision,
      final_confidence: confidence,
      confidence_breakdown: { ...decision.confidence_breakdown, total: confidence },
      review_required: decision.conflict || requiresExtractionReview(field, confidence, externallyValidated),
      provenance: {
        ...decision.provenance,
        selection_reason: `${decision.provenance.selection_reason}; policy ${policy.review_threshold}/${policy.auto_accept_threshold}`,
      },
    };
  }

  private consensusCount(field: string, decision: FieldDecision): number {
    const selected = this.normalizeForComparison(field, decision.final_value);
    return decision.candidates.filter(candidate => this.normalizeForComparison(field, candidate.value) === selected).length;
  }

  private calculateFieldConfidence(field: string, value: any, engine: EngineName, engineConfidence: number): number {
    let confidence = engineConfidence;

    if (engine === 'madison') {
      if (['invoice_number', 'mpo_number', 'po_number', 'total_amount', 'currency'].includes(field)) {
        confidence = Math.min(100, confidence + 10);
      }
    }
    if (['gemini', 'qwen', 'groq'].includes(engine)) {
      if (['vendor_name', 'ship_to', 'sold_to', 'payment_terms'].includes(field)) {
        confidence = Math.min(100, confidence + 5);
      }
    }
    if (engine === 'vendor_rules') {
      confidence = Math.min(100, confidence + 15);
    }
    if (engine === 'nextgen') {
      if (['brand', 'brand_code', 'season', 'vendor_name', 'po_number', 'mpo_number'].includes(field)) {
        confidence = 100;
      }
    }
    if (engine === 'structured') confidence = Math.max(confidence, 99);

    const normalizedField = field.replace(/^line_items\./, '');
    if (['total_amount', 'line_amount', 'unit_price', 'quantity', 'selling_quantity'].includes(normalizedField) &&
        (isNaN(Number(String(value).replace(/,/g, ''))) || Number(String(value).replace(/,/g, '')) < 0)) {
      confidence = Math.min(confidence, 30);
    }
    if (normalizedField === 'invoice_date' && !this.isValidDate(value)) {
      confidence = Math.min(confidence, 40);
    }
    if (normalizedField === 'currency' && value && !['USD', 'HKD', 'EUR', 'IDR', 'PHP', 'JPY', 'CNY', 'GBP', 'AUD', 'CAD', 'SGD', 'VND'].includes(String(value).toUpperCase())) {
      confidence = Math.min(confidence, 50);
    }

    return Math.round(confidence);
  }

  // ============================================================================
  // EVIDENCE EXTRACTION
  // ============================================================================

  private extractEvidence(field: string, value: any, rawText?: string): FieldEvidence {
    const evidence: FieldEvidence = {};
    if (!rawText || !value) return evidence;

    const valueStr = String(value).trim();
    if (valueStr.length === 0 || valueStr.length > 100) return evidence;

    const valueIndex = rawText.indexOf(valueStr);
    if (valueIndex !== -1) {
      const beforeMatch = rawText.substring(0, valueIndex);
      const newlineCount = (beforeMatch.match(/\n/g) || []).length;
      evidence.page = 1;
      evidence.line = newlineCount + 1;

      const start = Math.max(0, valueIndex - 50);
      const end = Math.min(rawText.length, valueIndex + valueStr.length + 50);
      evidence.raw_text_snippet = rawText.substring(start, end).replace(/\n/g, ' ');

      const beforeText = rawText.substring(start, valueIndex);
      const labelMatch = beforeText.match(/([A-Z][A-Za-z\s\/]+)[:\s]+$/);
      if (labelMatch) {
        evidence.matched_label = labelMatch[1].trim();
      }
    }

    return evidence;
  }

  // ============================================================================
  // STRUCTURED LEARNING ENGINE
  // ============================================================================

  private learnedRulesCache: Map<string, StructuredLearningRule[]> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  invalidateLearningCache(vendorName?: string) {
    if (vendorName) this.learnedRulesCache.delete(vendorName.toLowerCase());
    else this.learnedRulesCache.clear();
    this.cacheExpiry = 0;
  }

  private async getLearnedRules(vendorName?: string): Promise<StructuredLearningRule[]> {
    if (!vendorName) return [];

    const cacheKey = vendorName.toLowerCase();
    if (Date.now() < this.cacheExpiry && this.learnedRulesCache.has(cacheKey)) {
      return this.learnedRulesCache.get(cacheKey)!;
    }

    try {
      const corrections = await correctionLogService.findSimilarCorrections('', vendorName, undefined, 20);
      const rules: StructuredLearningRule[] = [];

      for (const correction of corrections) {
        const original = correction.original_fields as any;
        const corrected = correction.corrected_fields as any;
        if (!original || !corrected) continue;

        for (const fieldName of Object.keys(corrected)) {
          const origVal = original[fieldName];
          const corrVal = corrected[fieldName];
          if (origVal !== undefined && corrVal !== undefined && String(origVal) !== String(corrVal)) {
            const reason = this.inferCorrectionReason(fieldName, String(origVal), String(corrVal));
            rules.push({
              vendor: vendorName,
              field: fieldName,
              wrong_value: String(origVal),
              correct_value: String(corrVal),
              reason,
              use_count: correction.use_count || 0,
              created_at: correction.created_at,
            });
          }
        }
      }

      this.learnedRulesCache.set(cacheKey, rules);
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      if (rules.length > 0) {
        logger.info(`[FieldDecisionEngine] Loaded ${rules.length} learned rules for vendor: ${vendorName}`);
      }
      return rules;
    } catch (error) {
      logger.error('[FieldDecisionEngine] Failed to load learned rules:', error);
      return [];
    }
  }

  private inferCorrectionReason(field: string, wrong: string, correct: string): string {
    const substitutions: Array<[string, string]> = [
      ['O', '0'], ['I', '1'], ['l', '1'], ['S', '5'], ['B', '8'], ['Z', '2'], ['G', '6'],
    ];

    if (wrong.length === correct.length) {
      const diffs: string[] = [];
      for (let i = 0; i < wrong.length; i++) {
        if (wrong[i] !== correct[i]) {
          const sub = substitutions.find(
            ([a, b]) => (wrong[i].toUpperCase() === a && correct[i] === b) ||
                        (wrong[i].toUpperCase() === b && correct[i] === a)
          );
          if (sub) diffs.push(`OCR ${wrong[i]}→${correct[i]}`);
        }
      }
      if (diffs.length > 0) return `OCR error: ${diffs.join(', ')}`;
    }

    if (field === 'total_amount') {
      const w = Number(wrong);
      const c = Number(correct);
      if (!isNaN(w) && !isNaN(c) && Math.abs(w - c) < 1) return 'Amount rounding correction';
    }

    if (field === 'invoice_date' || field === 'due_date') {
      if (this.normalizeDate(wrong) === this.normalizeDate(correct)) return 'Date format normalization';
    }

    if (field === 'vendor_name' && wrong.length > correct.length) {
      return 'Vendor name noise removal';
    }

    return 'Manual correction';
  }

  private applyLearnedRules(fieldName: string, candidates: FieldCandidate[], rules: StructuredLearningRule[]): FieldCandidate | null {
    const fieldRules = rules.filter(r => r.field === fieldName);
    if (fieldRules.length === 0) return null;

    for (const candidate of candidates) {
      const candidateStr = String(candidate.value).trim();
      for (const rule of fieldRules) {
        if (candidateStr === rule.wrong_value || this.fuzzyMatch(candidateStr, rule.wrong_value)) {
          logger.info(
            `[FieldDecisionEngine] Applying learned rule: ${fieldName} ` +
            `"${rule.wrong_value}" → "${rule.correct_value}" (${rule.reason}, used ${rule.use_count}x)`
          );
          return {
            value: rule.correct_value,
            engine: 'vendor_rules',
            confidence: 95,
            evidence: { matched_label: `Learned: ${rule.reason} (used ${rule.use_count}x)` },
          };
        }
      }
    }
    return null;
  }

  async saveCorrection(input: {
    invoice_id?: string;
    vendor_name?: string;
    invoice_template_type?: string;
    raw_text?: string;
    original_fields: Record<string, any>;
    corrected_fields: Record<string, any>;
    note?: string;
    layout_fingerprint?: string;
  }): Promise<void> {
    if (input.vendor_name) {
      this.learnedRulesCache.delete(input.vendor_name.toLowerCase());
    }

    const reasons: string[] = [];
    for (const fieldName of Object.keys(input.corrected_fields)) {
      const origVal = input.original_fields?.[fieldName];
      const corrVal = input.corrected_fields[fieldName];
      if (origVal !== undefined && corrVal !== undefined && String(origVal) !== String(corrVal)) {
        const reason = this.inferCorrectionReason(fieldName, String(origVal), String(corrVal));
        reasons.push(`${fieldName}: ${reason}`);
      }
    }

    const enrichedNote = reasons.length > 0
      ? `${input.note || ''} | Reasons: ${reasons.join('; ')}`
      : input.note;

    await correctionLogService.saveCorrection({ ...input, note: enrichedNote });
    logger.info(`[FieldDecisionEngine] Correction saved for vendor: ${input.vendor_name} — ${reasons.join('; ')}`);
  }

  // ============================================================================
  // DUE DATE COMPUTATION
  // ============================================================================

  private computeDueDateFromTerms(invoiceDate: string, paymentTerms: string): string | null {
    try {
      const date = new Date(invoiceDate);
      if (isNaN(date.getTime())) return null;

      const terms = paymentTerms.toLowerCase();
      const netMatch = terms.match(/(\d+)\s*(?:days?|net)/);
      if (netMatch) {
        const days = parseInt(netMatch[1]);
        date.setDate(date.getDate() + days);
        return date.toISOString().split('T')[0];
      }
      if (/t\.?\s*t\.?|remittance|immediate|due on receipt/i.test(terms)) {
        return invoiceDate;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private normalizeForComparison(field: string, value: any): string {
    if (value === null || value === undefined) return '';
    let s = String(value).trim().toUpperCase();
    if (field === 'mpo_number') s = s.replace(/^MPO_?/, 'MPO').replace(/\s/g, '');
    if (field === 'currency') s = s.replace(/US\$/, 'USD').replace(/HK\$/, 'HKD');
    const normalizedField = field.replace(/^line_items\./, '');
    if (['total_amount', 'line_amount', 'unit_price', 'quantity', 'selling_quantity'].includes(normalizedField)) {
      const n = Number(String(value).replace(/,/g, ''));
      if (!isNaN(n)) return n.toFixed(2);
    }
    if (field === 'invoice_date' || field === 'due_date') {
      const normalized = this.normalizeDate(s);
      if (normalized) return normalized;
    }
    return s;
  }

  private normalizeDate(s: string): string | null {
    const match = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const match2 = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (match2) return `${match2[3]}-${match2[2].padStart(2, '0')}-${match2[1].padStart(2, '0')}`;
    return null;
  }

  private isValidDate(value: any): boolean {
    if (!value) return false;
    return !isNaN(new Date(value).getTime());
  }

  private getConflictSeverity(field: string): 'CRITICAL' | 'WARNING' | 'INFO' {
    if (['total_amount', 'invoice_number', 'mpo_number', 'po_number', 'vendor_name'].includes(field)) return 'CRITICAL';
    if (['invoice_date', 'due_date', 'currency', 'payment_terms'].includes(field)) return 'WARNING';
    return 'INFO';
  }

  private fuzzyMatch(a: string, b: string): boolean {
    if (a === b) return true;
    const normalized = (s: string) => s.replace(/0/g, 'O').replace(/1/g, 'I').toUpperCase();
    return normalized(a) === normalized(b);
  }
}

export const fieldDecisionEngine = FieldDecisionEngine.getInstance();
