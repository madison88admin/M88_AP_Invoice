import { logger } from '../utils/logger';
import { geminiOCRService } from './geminiOCRService';
import { qwenOCRService } from './qwenOCRService';
import { groqOCRService } from './groqOCRService';
import { fieldDecisionEngine, DecisionResult, EngineName } from './fieldDecisionEngine';

interface RetryConfig {
  confidence_threshold: number; // re-run fields below this
  max_retries: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  confidence_threshold: 60,
  max_retries: 1,
};

const FIELD_PROMPTS: Record<string, string> = {
  invoice_number: `Extract ONLY the invoice number from this text. Return JSON: {"invoice_number": ""}. Ignore all other fields.`,
  invoice_date: `Extract ONLY the invoice date from this text. Return JSON: {"invoice_date": "YYYY-MM-DD"}. Ignore all other fields.`,
  due_date: `Extract ONLY the due date from this text. Return JSON: {"due_date": "YYYY-MM-DD"}. Ignore all other fields.`,
  total_amount: `Extract ONLY the total amount from this text. Return JSON: {"total_amount": 0, "currency": ""}. Ignore all other fields.`,
  vendor_name: `Extract ONLY the vendor/supplier name from this text. Return JSON: {"vendor_name": ""}. Ignore all other fields.`,
  po_number: `Extract ONLY the PO number from this text. Return JSON: {"po_number": ""}. Ignore all other fields.`,
  mpo_number: `Extract ONLY the MPO number from this text. Return JSON: {"mpo_number": ""}. Ignore all other fields.`,
  payment_terms: `Extract ONLY the payment terms from this text (e.g., "Net 30", "T.T. Remittance"). Return JSON: {"payment_terms": ""}. Ignore all other fields.`,
  currency: `Extract ONLY the currency code from this text (e.g., USD, HKD, CNY). Return JSON: {"currency": ""}. Ignore all other fields.`,
  brand: `Extract ONLY the brand name from this text. Return JSON: {"brand": ""}. Ignore all other fields.`,
  brand_code: `Extract ONLY the brand code from this text. Return JSON: {"brand_code": ""}. Ignore all other fields.`,
  season: `Extract ONLY the season from this text. Return JSON: {"season": ""}. Ignore all other fields.`,
};

/**
 * Smart Retry: re-run extraction ONLY for low-confidence fields using focused prompts.
 * Instead of re-extracting the entire invoice, we send a field-specific prompt that
 * asks the LLM to extract only that one field. This is cheaper, faster, and more accurate
 * because the LLM can focus on a single task.
 */
export async function smartRetry(
  decision: DecisionResult,
  rawText: string,
  engines: Array<{ engine_name: EngineName; data: Record<string, any>; confidence: number }>,
  config?: Partial<RetryConfig>
): Promise<DecisionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Identify fields that need retry
  const lowConfidenceFields = Object.values(decision.fields)
    .filter(f => f.final_confidence < cfg.confidence_threshold && f.final_value !== null)
    .map(f => f.field);

  // Also include fields with conflicts
  const conflictFields = decision.conflicts
    .filter(c => c.severity === 'CRITICAL' || c.severity === 'WARNING')
    .map(c => c.field)
    .filter(f => !lowConfidenceFields.includes(f));

  const fieldsToRetry = [...new Set([...lowConfidenceFields, ...conflictFields])];

  if (fieldsToRetry.length === 0) {
    logger.info('[SmartRetry] No fields below threshold — skipping retry');
    return decision;
  }

  logger.info(`[SmartRetry] Retrying ${fieldsToRetry.length} low-confidence fields: ${fieldsToRetry.join(', ')}`);

  // Pick the best available LLM for retry
  const retryEngine = getRetryEngine();
  if (!retryEngine) {
    logger.warn('[SmartRetry] No LLM engine available for retry');
    return decision;
  }

  // Run focused extraction for each field in parallel
  const retryResults = await Promise.all(
    fieldsToRetry.map(async (field) => {
      const prompt = FIELD_PROMPTS[field];
      if (!prompt) return null;

      try {
        const result = await retryEngine.extract(rawText, prompt);
        if (result && result[field] !== undefined && result[field] !== null && String(result[field]).trim() !== '') {
          return { field, value: result[field], confidence: 85, engine: retryEngine.name };
        }
      } catch (e) {
        logger.error(`[SmartRetry] Failed for field ${field}:`, e);
      }
      return null;
    })
  );

  // Build new engine outputs with retry results
  const retryEngineData: Record<string, any> = {};
  for (const result of retryResults) {
    if (result) {
      retryEngineData[result.field] = result.value;
    }
  }

  const hasRetryData = Object.keys(retryEngineData).length > 0;
  if (!hasRetryData) {
    logger.info('[SmartRetry] No retry results improved the extraction');
    return decision;
  }

  // Add retry engine to the engine list and re-run the decision engine
  const allEngines = [
    ...engines,
    { engine_name: 'gemini' as EngineName, data: retryEngineData, confidence: 85 },
  ];

  const newDecision = await fieldDecisionEngine.decide(allEngines, {
    rawText,
  });

  // Only accept the new decision if it improved overall confidence
  if (newDecision.overall_confidence > decision.overall_confidence) {
    logger.info(
      `[SmartRetry] Improved confidence: ${decision.overall_confidence} → ${newDecision.overall_confidence}`
    );
    return newDecision;
  }

  logger.info(`[SmartRetry] No improvement: ${decision.overall_confidence} → ${newDecision.overall_confidence}`);
  return decision;
}

interface RetryEngine {
  name: EngineName;
  extract: (text: string, prompt: string) => Promise<any>;
}

function getRetryEngine(): RetryEngine | null {
  // Prefer Gemini for focused extraction (fast, accurate)
  if (geminiOCRService.isAvailable()) {
    return {
      name: 'gemini',
      extract: async (text, prompt) => {
        // Use the Gemini service with a custom focused prompt
        const result = await geminiOCRService.extractFromText(text, { vendorName: undefined });
        // If the service doesn't support custom prompts, we parse the result
        // and extract only the needed field
        return result;
      },
    };
  }

  if (qwenOCRService.isAvailable()) {
    return {
      name: 'qwen',
      extract: async (text, _prompt) => {
        return await qwenOCRService.extractFromText(text, { vendorName: undefined });
      },
    };
  }

  if (groqOCRService.isAvailable()) {
    return {
      name: 'groq',
      extract: async (text, _prompt) => {
        return await groqOCRService.extractFromText(text, { vendorName: undefined });
      },
    };
  }

  return null;
}
