import { logger } from '../utils/logger';
import { geminiOCRService } from './geminiOCRService';
import { qwenOCRService } from './qwenOCRService';
import { DecisionResult } from './fieldDecisionEngine';

export interface ValidationIssue {
  field: string;
  issue: string;
  suggested_value?: any;
  severity: 'ERROR' | 'WARNING' | 'INFO';
}

export interface SelfValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
  corrections: Record<string, any>;
  summary: string;
}

const SELF_VALIDATION_PROMPT = `You are an invoice data reviewer. Do NOT extract data. Review the provided JSON for inconsistencies and errors only.

Check for:
1. Date logic: Is due_date after invoice_date? Is invoice_date in the future?
2. Amount logic: Does total_amount seem reasonable? Is currency valid?
3. Field consistency: Does vendor_name match known vendor patterns? Does invoice_number format look correct?
4. Missing critical fields: Are vendor_name, invoice_number, invoice_date, total_amount all present?
5. PO/MPO consistency: If both po_number and mpo_number exist, are they compatible?
6. Payment terms: Do payment_terms make sense given the due_date and invoice_date?

Return JSON only:
{
  "issues": [
    {
      "field": "field_name",
      "issue": "description of the problem",
      "suggested_value": "corrected value if known, else null",
      "severity": "ERROR" | "WARNING" | "INFO"
    }
  ],
  "summary": "brief summary of validation results"
}

If no issues found, return: {"issues": [], "summary": "All fields validated successfully"}`;

/**
 * Self Validation: after extraction, an AI reviews the extracted JSON
 * for consistency errors. This does NOT re-extract — it only reviews
 * the existing data and suggests corrections.
 */
export async function runSelfValidation(
  decision: DecisionResult,
  rawText?: string
): Promise<SelfValidationResult> {
  const extractedData = decision.final;

  // Build the data JSON for the reviewer
  const dataForReview = {
    vendor_name: extractedData.vendor_name,
    invoice_number: extractedData.invoice_number,
    invoice_date: extractedData.invoice_date,
    due_date: extractedData.due_date,
    payment_terms: extractedData.payment_terms,
    total_amount: extractedData.total_amount,
    currency: extractedData.currency,
    po_number: extractedData.po_number,
    mpo_number: extractedData.mpo_number,
    brand: extractedData.brand,
    brand_code: extractedData.brand_code,
    season: extractedData.season,
    line_item_count: extractedData.line_items?.length || 0,
  };

  // First, run rule-based checks (no AI needed)
  const ruleBasedIssues = runRuleBasedValidation(dataForReview);

  // Then, run AI-based review if available
  let aiIssues: ValidationIssue[] = [];
  try {
    aiIssues = await runAIValidation(dataForReview, rawText);
  } catch (e) {
    logger.error('[SelfValidation] AI review failed:', e);
  }

  const allIssues = [...ruleBasedIssues, ...aiIssues];
  const corrections: Record<string, any> = {};

  for (const issue of allIssues) {
    if (issue.suggested_value !== undefined && issue.suggested_value !== null) {
      corrections[issue.field] = issue.suggested_value;
    }
  }

  const errors = allIssues.filter(i => i.severity === 'ERROR');
  const warnings = allIssues.filter(i => i.severity === 'WARNING');
  const passed = errors.length === 0;

  const summary = passed
    ? `Validation passed with ${warnings.length} warning(s)`
    : `Validation failed: ${errors.length} error(s), ${warnings.length} warning(s)`;

  if (allIssues.length > 0) {
    logger.info(`[SelfValidation] ${summary}: ${allIssues.map(i => `${i.field}(${i.severity})`).join(', ')}`);
  }

  return {
    passed,
    issues: allIssues,
    corrections,
    summary,
  };
}

/**
 * Rule-based validation — no AI needed, just logic checks.
 */
function runRuleBasedValidation(data: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Missing critical fields
  const criticalFields = ['vendor_name', 'invoice_number', 'invoice_date', 'total_amount'];
  for (const field of criticalFields) {
    if (!data[field] || String(data[field]).trim() === '') {
      issues.push({
        field,
        issue: `Missing critical field: ${field}`,
        severity: 'ERROR',
      });
    }
  }

  // Date logic
  if (data.invoice_date && data.due_date) {
    const invDate = new Date(data.invoice_date);
    const dueDate = new Date(data.due_date);
    if (!isNaN(invDate.getTime()) && !isNaN(dueDate.getTime())) {
      if (dueDate < invDate) {
        issues.push({
          field: 'due_date',
          issue: `Due date (${data.due_date}) is before invoice date (${data.invoice_date})`,
          suggested_value: null,
          severity: 'ERROR',
        });
      }
    }
  }

  // Invoice date in future
  if (data.invoice_date) {
    const invDate = new Date(data.invoice_date);
    const now = new Date();
    if (!isNaN(invDate.getTime()) && invDate > now) {
      issues.push({
        field: 'invoice_date',
        issue: `Invoice date (${data.invoice_date}) is in the future`,
        severity: 'WARNING',
      });
    }
  }

  // Amount validation
  if (data.total_amount !== undefined && data.total_amount !== null) {
    const amount = Number(data.total_amount);
    if (isNaN(amount)) {
      issues.push({
        field: 'total_amount',
        issue: `Total amount is not a valid number: ${data.total_amount}`,
        severity: 'ERROR',
      });
    } else if (amount <= 0) {
      issues.push({
        field: 'total_amount',
        issue: `Total amount is zero or negative: ${amount}`,
        severity: 'ERROR',
      });
    }
  }

  // Currency validation
  const validCurrencies = ['USD', 'HKD', 'EUR', 'IDR', 'PHP', 'JPY', 'CNY', 'GBP', 'AUD', 'CAD', 'SGD', 'VND'];
  if (data.currency && !validCurrencies.includes(String(data.currency).toUpperCase())) {
    issues.push({
      field: 'currency',
      issue: `Unrecognized currency code: ${data.currency}`,
      severity: 'WARNING',
    });
  }

  // PO/MPO consistency
  if (data.po_number && data.mpo_number) {
    const poNum = String(data.po_number).replace(/\D/g, '');
    const mpoNum = String(data.mpo_number).replace(/\D/g, '');
    if (poNum && mpoNum && poNum !== mpoNum && !mpoNum.includes(poNum) && !poNum.includes(mpoNum)) {
      issues.push({
        field: 'mpo_number',
        issue: `PO number (${data.po_number}) and MPO number (${data.mpo_number}) seem inconsistent`,
        severity: 'WARNING',
      });
    }
  }

  return issues;
}

/**
 * AI-based validation — asks an LLM to review the extracted JSON.
 */
async function runAIValidation(data: any, rawText?: string): Promise<ValidationIssue[]> {
  const dataJSON = JSON.stringify(data, null, 2);
  const contextText = rawText ? rawText.substring(0, 2000) : '';

  const fullPrompt = `${SELF_VALIDATION_PROMPT}

Extracted invoice data to review:
${dataJSON}

${contextText ? `Reference text (first 2000 chars):\n${contextText}` : ''}

Return JSON only:`;

  // Try Gemini first, then Qwen
  if (geminiOCRService.isAvailable()) {
    try {
      const result = await callGeminiForValidation(fullPrompt);
      if (result) return parseValidationResponse(result);
    } catch (e) {
      logger.error('[SelfValidation] Gemini review failed:', e);
    }
  }

  return [];
}

async function callGeminiForValidation(prompt: string): Promise<any> {
  // Use the Gemini service's internal API to send a custom prompt
  // We reuse the existing service but with a validation prompt instead of extraction
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return null;
}

function parseValidationResponse(response: any): ValidationIssue[] {
  if (!response || !response.issues || !Array.isArray(response.issues)) {
    return [];
  }

  return response.issues.map((issue: any) => ({
    field: issue.field || 'unknown',
    issue: issue.issue || '',
    suggested_value: issue.suggested_value || undefined,
    severity: (issue.severity || 'INFO') as 'ERROR' | 'WARNING' | 'INFO',
  }));
}
