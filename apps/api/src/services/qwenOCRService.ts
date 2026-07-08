import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';
import type { ExtractionContext } from './consensusExtractor';

interface ExtractedLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  item_code?: string;
}

export interface ExtractedInvoiceData {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  payment_terms?: string;
  total_amount?: number;
  currency?: string;
  po_number?: string;
  mpo_number?: string;
  brand?: string;
  brand_code?: string;
  season?: string;
  ship_to?: string;
  sold_to?: string;
  line_items?: ExtractedLineItem[];
  raw_text?: string;
  extraction_method?: string;
  engine_name?: string;
  confidence?: number;
}

const EXTRACTION_PROMPT = `
You are an invoice data extractor for Madison 88, a fashion brand management company.

Extract the following fields from this invoice text. Return ONLY valid JSON, no markdown, no explanation.

Fields to extract:
- vendor_name: Company name of the vendor/supplier (NOT Madison 88 — they are the buyer)
- invoice_number: Invoice number or reference
- invoice_date: Date of invoice (format: YYYY-MM-DD)
- due_date: Due date / payment due date (format: YYYY-MM-DD). Look for phrases like "Please pay on May 7", "Payment due May 7", or "Due date: May 7" and convert to YYYY-MM-DD using the invoice year if no year is given.
- payment_terms: Payment terms text (e.g., "30 Days", "Net 30", "T/T 100% before shipment")
- total_amount: Final total amount (number only, no currency symbol)
- currency: Currency code (USD, HKD, EUR, etc.)
- po_number: Purchase Order number if present (format like PO000002_KEY or extract PO#2924)
- mpo_number: Material Purchase Order number (format like MPO015713 — extract from Customer PO field which may contain "TNF F26 JAN BUY_MPO15371_MDDC_...")
- brand: Brand name (The North Face, Under Armour, Vans, Columbia, etc.)
- brand_code: Brand code (TNF, UA, VNS, CSC, HH, BUR, etc.)
- season: Season code (like F26, S26, F25, etc.)
- ship_to: Ship to / delivery / consignee company and address. If the invoice shows two columns (e.g., "Delivery address" and "Invoice address"), extract ONLY the delivery address column, NOT the invoice address column.
- sold_to: Sold to / invoice / buyer company and address. If the invoice shows two columns (e.g., "Delivery address" and "Invoice address"), extract ONLY the invoice address column, NOT the delivery address column.
- line_items: Array of line items with:
  - description: item description
  - quantity: quantity as number
  - unit_price: unit price as number
  - total_amount: line total as number
  - item_code: item code if present

IMPORTANT RULES:
1. vendor_name is the SENDER of the invoice, NOT Madison 88
2. For mpo_number: look in "Customer PO" or "CUSTOMER PO" field
   - Pattern: "TNF F26 JAN BUY_MPO15371_MDDC_..." → extract "MPO15371"
   - Pattern: "MPO015713" → extract "MPO015713"
   - Regex: /MPO(\\d+)/i
3. total_amount must be a NUMBER only (e.g. 37.94 not "$37.94")
4. For line_items: extract EVERY line item row from the invoice table. Each row has:
   - description (item description text)
   - quantity (number from Quantity/Qty column, e.g., 12900, 6075, 8300)
   - unit_price (number from Unit Price column)
   - total_amount (number from Amount/Total column)
   - item_code (item code if present, e.g., "SA10047935", "M5PG*")
   Do not skip line items. If quantity looks like a unit price, re-check the column.
5. If a field is not found, use null
6. Return ONLY the JSON object, nothing else
7. This invoice may be bilingual (English + Chinese). Extract from both languages if present.
   - Chinese labels: 发票号码 (invoice number), 发票日期 (invoice date), 总计/合计 (total), 付款条件 (payment terms)

Example output:
{
  "vendor_name": "Avery Dennison Hong Kong B.V.",
  "invoice_number": "100703828",
  "invoice_date": "2026-05-07",
  "due_date": "2026-06-06",
  "payment_terms": "Net 30",
  "total_amount": 37.94,
  "currency": "USD",
  "po_number": null,
  "mpo_number": "MPO15371",
  "brand": "The North Face",
  "brand_code": "TNF",
  "season": "F26",
  "ship_to": "PT UWU JUMP INDONESIA",
  "sold_to": "256086 / THE NORTH FACE",
  "line_items": [
    {
      "description": "TNF-INDO-HT(MDDC)",
      "quantity": 120,
      "unit_price": 0.06656,
      "total_amount": 7.99,
      "item_code": "1-292738-000-02"
    }
  ]
}

Invoice text to extract from:
`;

export class QwenOCRService {
  private static instance: QwenOCRService;
  private apiKey: string | null = null;
  private baseURL: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  private model: string = 'qwen-plus';
  private isConfigured: boolean = false;

  private constructor() {
    const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    if (!apiKey) {
      logger.warn('DASHSCOPE_API_KEY not configured — Qwen OCR engine disabled');
      return;
    }

    this.apiKey = apiKey;
    this.baseURL = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = process.env.QWEN_MODEL || 'qwen-plus';
    this.isConfigured = true;
    logger.info(`Qwen OCR service initialized (model: ${this.model})`);
  }

  static getInstance(): QwenOCRService {
    if (!QwenOCRService.instance) {
      QwenOCRService.instance = new QwenOCRService();
    }
    return QwenOCRService.instance;
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  async extractFromText(
    rawText: string,
    context?: ExtractionContext
  ): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || !this.apiKey) {
      logger.warn('Qwen OCR not configured — skipping');
      return null;
    }

    try {
      logger.info('Qwen OCR extraction started');

      const MAX_TEXT_LENGTH = Number(process.env.QWEN_MAX_TEXT_LENGTH) || 12000;
      const truncatedText = rawText.length > MAX_TEXT_LENGTH
        ? rawText.substring(0, MAX_TEXT_LENGTH) + '\n[TEXT TRUNCATED]'
        : rawText;

      const fewShot = context
        ? await correctionLogService.getFewShotPrompt(rawText, context.vendorName, context.invoiceTemplateType)
        : '';

      const prompt = (fewShot ? fewShot + '\n\n' : '') + EXTRACTION_PROMPT + truncatedText;

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a precise invoice data extraction assistant. Always return valid JSON only. You handle bilingual invoices (English + Chinese) with high accuracy.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        logger.error(`Qwen API error ${response.status}: ${errBody.substring(0, 300)}`);
        return null;
      }

      const data = await response.json() as any;
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) {
        logger.warn('Qwen OCR returned empty content');
        return null;
      }

      const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      let extracted: ExtractedInvoiceData;
      try {
        extracted = JSON.parse(cleaned) as ExtractedInvoiceData;
      } catch (parseError) {
        logger.error('JSON parse failed, attempting recovery:', {
          error: parseError instanceof Error ? parseError.message : 'unknown',
          textLength: cleaned.length,
          textSample: cleaned.substring(0, 200),
        });

        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('No JSON object found in Qwen response');
          return null;
        }

        try {
          extracted = JSON.parse(jsonMatch[0]) as ExtractedInvoiceData;
          logger.info('JSON recovery successful for Qwen response');
        } catch (recoveryError) {
          logger.error('JSON recovery failed:', {
            error: recoveryError instanceof Error ? recoveryError.message : 'unknown',
          });
          return null;
        }
      }

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

      extracted.extraction_method = 'qwen';
      extracted.engine_name = 'qwen';
      extracted.confidence = this.calculateConfidence(extracted);

      logger.info(`Qwen OCR extracted: vendor=${extracted.vendor_name}, amount=${extracted.total_amount}, confidence=${extracted.confidence}`);

      return extracted;
    } catch (error) {
      logger.error('Qwen OCR extraction failed:', error);
      console.error('[QwenOCRService] extractFromText failed:', error);
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
}

export const qwenOCRService = QwenOCRService.getInstance();
