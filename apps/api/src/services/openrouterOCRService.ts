import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';
import { EXTRACTION_PROMPT } from './geminiOCRService';
import type { ExtractionContext } from './consensusExtractor';

interface ExtractedLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  item_code?: string;
  size?: string;
}

export interface ExtractedInvoiceData {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  payment_terms?: string;
  subtotal?: number;
  total_amount?: number;
  currency?: string;
  po_number?: string;
  mpo_number?: string;
  brand?: string;
  brand_code?: string;
  season?: string;
  ship_to?: string;
  sold_to?: string;
  qty_shipped?: number;
  document_type?: string;
  beneficiary_name?: string;
  bank_name?: string;
  swift_code?: string;
  account_number?: string;
  // Charges
  bank_charges?: number;
  tt_charge?: number;
  freight_charges?: number;
  courier_charges?: number;
  handling_fee?: number;
  finance_surcharge?: number;
  tax_amount?: number;
  discount_amount?: number;
  setup_charge?: number;
  sample_charge?: number;
  min_order_charge?: number;
  additional_charges?: number;
  line_items?: ExtractedLineItem[];
  signatures?: { signatory_name: string; signatory_role?: string; signed_date?: string }[];
  incoterm?: string;
  exchange_rate?: number;
  invoice_currency_original?: string;
  is_handwritten?: boolean;
  is_statement?: boolean;
  raw_text?: string;
  extraction_method?: string;
  engine_name?: string;
  confidence?: number;
}

/**
 * OpenRouter OCR service — free-tier vision LLM API (zero GPU compute on our side).
 *
 * Default model is a free vision model (qwen2.5-vl-72b) that reads page images
 * directly, so it works on scanned PDFs where text extraction yields nothing.
 * Uses the same OpenAI-compatible chat/completions endpoint as the other LLM engines.
 */
export class OpenRouterOCRService {
  private static instance: OpenRouterOCRService;
  private apiKey: string | null = null;
  private model: string = 'qwen/qwen-2.5-vl-72b-instruct:free';
  private timeoutMs: number = 90000;
  private maxImagePages: number = 5;
  private isConfigured: boolean = false;

  private constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      logger.warn('OPENROUTER_API_KEY not configured — OpenRouter OCR engine disabled');
      return;
    }

    this.apiKey = apiKey;
    this.model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-nano-12b-v2-vl:free';
    this.timeoutMs = (Number(process.env.OPENROUTER_TIMEOUT) || 90) * 1000;
    this.maxImagePages = Number(process.env.OPENROUTER_MAX_IMAGE_PAGES) || 5;
    this.isConfigured = true;
    logger.info(`OpenRouter OCR service initialized with model ${this.model}`);
  }

  static getInstance(): OpenRouterOCRService {
    if (!OpenRouterOCRService.instance) {
      OpenRouterOCRService.instance = new OpenRouterOCRService();
    }
    return OpenRouterOCRService.instance;
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  private async chatCompletion(messages: any[], maxTokens: number): Promise<string | null> {
    if (!this.isConfigured || !this.apiKey) {
      logger.warn('OpenRouter OCR not configured — skipping request');
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are a precise invoice data extraction assistant. Always return valid JSON only.' },
            ...messages,
          ],
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.error(`OpenRouter returned ${response.status}: ${response.statusText} ${body.slice(0, 300)}`);
        return null;
      }

      const data = await response.json() as any;
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      if (!text) {
        logger.warn('OpenRouter returned empty content');
        return null;
      }
      return text;
    } catch (error) {
      logger.error('OpenRouter request failed:', error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseResult(text: string, method: string): ExtractedInvoiceData | null {
    const cleaned = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let extracted: ExtractedInvoiceData;
    try {
      extracted = JSON.parse(cleaned) as ExtractedInvoiceData;
    } catch (parseError) {
      logger.error('OpenRouter JSON parse failed, attempting recovery:', {
        error: parseError instanceof Error ? parseError.message : 'unknown',
        textSample: cleaned.substring(0, 200),
      });
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('No JSON object found in OpenRouter response');
        return null;
      }
      try {
        extracted = JSON.parse(jsonMatch[0]) as ExtractedInvoiceData;
        logger.info('OpenRouter JSON recovery successful');
      } catch {
        logger.error('OpenRouter JSON recovery failed');
        return null;
      }
    }

    if (extracted.total_amount !== undefined && extracted.total_amount !== null) {
      extracted.total_amount = Number(extracted.total_amount);
      if (isNaN(extracted.total_amount)) extracted.total_amount = undefined;
    }
    if (extracted.subtotal !== undefined && extracted.subtotal !== null) {
      extracted.subtotal = Number(extracted.subtotal);
      if (isNaN(extracted.subtotal)) extracted.subtotal = undefined;
    }
    if (extracted.line_items) {
      extracted.line_items = extracted.line_items.map(li => ({
        ...li,
        quantity: Number(li.quantity) || 0,
        unit_price: Number(li.unit_price) || 0,
        total_amount: Number(li.total_amount) || 0,
      }));
    }

    extracted.extraction_method = method;
    extracted.engine_name = 'openrouter';
    extracted.confidence = this.calculateConfidence(extracted);

    logger.info(`OpenRouter OCR extracted: vendor=${extracted.vendor_name}, invoice#=${extracted.invoice_number}, amount=${extracted.total_amount}, confidence=${extracted.confidence}`);
    return extracted;
  }

  /** Text-mode extraction (fast path when readable text is available). */
  async extractFromText(rawText: string, context?: ExtractionContext): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured) return null;

    const MAX_TEXT_LENGTH = Number(process.env.OPENROUTER_MAX_TEXT_LENGTH) || 12000;
    const truncatedText = rawText.length > MAX_TEXT_LENGTH
      ? rawText.substring(0, MAX_TEXT_LENGTH) + '\n[TEXT TRUNCATED]'
      : rawText;

    const fewShot = context
      ? await correctionLogService.getFewShotPrompt(rawText, context.vendorName, context.invoiceTemplateType)
      : '';

    const prompt = (fewShot ? fewShot + '\n\n' : '') + EXTRACTION_PROMPT + truncatedText;
    const text = await this.chatCompletion([{ role: 'user', content: prompt }], 4096);
    if (!text) return null;
    return this.parseResult(text, 'openrouter-text');
  }

  /**
   * Vision-mode extraction from page images (base64 PNG). Works on scanned PDFs.
   * Only the first `maxImagePages` pages are sent to stay within free-tier limits.
   */
  async extractFromImages(imagesBase64: string[], context?: ExtractionContext): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || imagesBase64.length === 0) return null;

    const pages = imagesBase64.slice(0, this.maxImagePages);
    const fewShot = context
      ? await correctionLogService.getFewShotPrompt('', context.vendorName, context.invoiceTemplateType)
      : '';

    const prompt = (fewShot ? fewShot + '\n\n' : '') +
      EXTRACTION_PROMPT +
      (pages.length < imagesBase64.length
        ? `\n[The PDF has ${imagesBase64.length} pages; only the first ${pages.length} are shown below.]`
        : '') +
      '\nInvoice page image(s) above — extract all invoice data.';

    const text = await this.chatCompletion([
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...pages.map(b64 => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ],
      },
    ], 4096);

    if (!text) return null;
    return this.parseResult(text, 'openrouter-vision');
  }

  calculateConfidence(result: ExtractedInvoiceData): number {
    let score = 0;
    if (result.vendor_name) score += 25;
    if (result.total_amount) score += 25;
    if (result.invoice_number) score += 20;
    if (result.po_number || result.mpo_number) score += 20;
    if (result.invoice_date) score += 5;
    if (result.line_items && result.line_items.length > 0) score += 5;
    return score;
  }
}

export const openrouterOCRService = OpenRouterOCRService.getInstance();
