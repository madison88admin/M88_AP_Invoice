import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';

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
  raw_text?: string;
  extraction_method?: string;
  engine_name?: string;
  confidence?: number;
}

const EXTRACTION_PROMPT = `Extract invoice fields from the text below. Return ONLY valid JSON.
vendor_name = supplier company (NOT Madison 88), invoice_number, invoice_date (YYYY-MM-DD), due_date (YYYY-MM-DD), payment_terms, total_amount (number), currency (USD/HKD/etc), po_number (e.g. PO3011), mpo_number (e.g. MPO015713), brand, brand_code, season, qty_shipped, document_type, bank_name, swift_code, account_number, subtotal, bank_charges, freight_charges, additional_charges, discount_amount, tax_amount, line_items [{description, quantity, unit_price, total_amount, item_code, size}].
If a field is missing, use null. Return ONLY the JSON object.
`;

export class OllamaOCRService {
  private static instance: OllamaOCRService;
  private baseUrl: string | null = null;
  private model: string = 'qwen2.5:3b-instruct';
  private timeout: number = 60000;
  private isConfigured: boolean = false;

  private constructor() {
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) {
      logger.warn('OLLAMA_BASE_URL not configured — Ollama OCR fallback disabled');
      return;
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
    this.timeout = (Number(process.env.OLLAMA_TIMEOUT) || 60) * 1000;
    this.isConfigured = true;
    logger.info(`Ollama OCR service initialized at ${this.baseUrl} with model ${this.model}`);
  }

  static getInstance(): OllamaOCRService {
    if (!OllamaOCRService.instance) {
      OllamaOCRService.instance = new OllamaOCRService();
    }
    return OllamaOCRService.instance;
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return res.ok;
    } catch (error) {
      logger.warn('Ollama health check failed:', error);
      return false;
    }
  }

  async extractFromText(
    rawText: string,
    options?: { vendorName?: string; invoiceTemplateType?: string }
  ): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || !this.baseUrl) {
      logger.warn('Ollama OCR not configured — skipping fallback');
      return null;
    }

    try {
      logger.info('Ollama OCR fallback triggered — extracting invoice data');

      const MAX_OLLAMA_TEXT_LENGTH = Number(process.env.OLLAMA_MAX_TEXT_LENGTH) || 5000;
      const truncatedText = rawText.length > MAX_OLLAMA_TEXT_LENGTH
        ? rawText.substring(0, MAX_OLLAMA_TEXT_LENGTH) + '\n[TEXT TRUNCATED]'
        : rawText;

      const fewShot = options
        ? await correctionLogService.getFewShotPrompt(rawText, options.vendorName, options.invoiceTemplateType)
        : '';

      const userPrompt = (fewShot ? fewShot + '\n\n' : '') + 'Extract invoice fields from this text. Return ONLY valid JSON:\n' + truncatedText;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are an invoice data extractor. Return ONLY valid JSON, no explanation.' },
            { role: 'user', content: EXTRACTION_PROMPT + userPrompt },
          ],
          stream: false,
          think: false,
          options: {
            temperature: 0.1,
            num_ctx: 8192,
            num_predict: 2048,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`Ollama returned ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json() as any;
      const text = data.message?.content || data.response || '';

      if (!text) {
        logger.warn('Ollama OCR returned empty content');
        return null;
      }

      const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const extracted = JSON.parse(cleaned) as ExtractedInvoiceData;

      if (extracted.total_amount) {
        extracted.total_amount = Number(extracted.total_amount);
        if (isNaN(extracted.total_amount)) extracted.total_amount = undefined;
      }

      if (extracted.line_items) {
        extracted.line_items = extracted.line_items.map(li => ({
          ...li,
          quantity: Number(li.quantity) || 0,
          unit_price: Number(li.unit_price) || 0,
          total_amount: Number(li.total_amount) || 0,
        }));
      }

      extracted.extraction_method = 'ollama-fallback';
      extracted.engine_name = 'ollama';
      extracted.confidence = this.calculateConfidence(extracted);

      logger.info(`Ollama OCR extracted: vendor=${extracted.vendor_name}, amount=${extracted.total_amount}, confidence=${extracted.confidence}`);

      return extracted;
    } catch (error) {
      logger.error('Ollama OCR extraction failed:', error);
      console.error('[OllamaOCRService] extractFromText failed:', error);
      return null;
    }
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

  async extractFromImage(
    imageBase64: string,
    options?: { vendorName?: string; invoiceTemplateType?: string }
  ): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || !this.baseUrl) {
      logger.warn('Ollama OCR not configured — skipping image fallback');
      return null;
    }

    try {
      logger.info('Ollama OCR image fallback triggered — sending image to vision model');

      const fewShot = options
        ? await correctionLogService.getFewShotPrompt('', options.vendorName, options.invoiceTemplateType)
        : '';

      const userPrompt = (fewShot ? fewShot + '\n\n' : '') + 'Extract all invoice fields from the image below. Return ONLY valid JSON.';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: 'You are an invoice data extractor. Return ONLY valid JSON, no explanation.' },
            { role: 'user', content: EXTRACTION_PROMPT + userPrompt, images: [imageBase64] },
          ],
          stream: false,
          think: false,
          options: {
            temperature: 0.1,
            num_ctx: 8192,
            num_predict: 2048,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`Ollama returned ${response.status}: ${response.statusText}`);
        return null;
      }

      const data = await response.json() as any;
      const text = data.message?.content || data.response || '';

      if (!text) {
        logger.warn('Ollama OCR image returned empty content');
        return null;
      }

      const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const extracted = JSON.parse(cleaned) as ExtractedInvoiceData;

      if (extracted.total_amount) {
        extracted.total_amount = Number(extracted.total_amount);
        if (isNaN(extracted.total_amount)) extracted.total_amount = undefined;
      }

      if (extracted.line_items) {
        extracted.line_items = extracted.line_items.map(li => ({
          ...li,
          quantity: Number(li.quantity) || 0,
          unit_price: Number(li.unit_price) || 0,
          total_amount: Number(li.total_amount) || 0,
        }));
      }

      extracted.extraction_method = 'ollama-vision';
      extracted.engine_name = 'ollama';
      extracted.confidence = this.calculateConfidence(extracted);

      logger.info(`Ollama OCR image extracted: vendor=${extracted.vendor_name}, amount=${extracted.total_amount}, confidence=${extracted.confidence}`);

      return extracted;
    } catch (error) {
      logger.error('Ollama OCR image extraction failed:', error);
      console.error('[OllamaOCRService] extractFromImage failed:', error);
      return null;
    }
  }
}

export const ollamaOCRService = OllamaOCRService.getInstance();
