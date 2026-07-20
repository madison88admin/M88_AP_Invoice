import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';

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

const EXTRACTION_PROMPT = `
You are an invoice data extractor for Madison 88, a fashion brand management company.

Extract the following fields from this invoice text. Return ONLY valid JSON, no markdown, no explanation.

Fields to extract:
- vendor_name: Company name of the vendor/supplier (NOT Madison 88 — they are the buyer)
- invoice_number: Invoice number or reference
- invoice_date: Date of invoice (format: YYYY-MM-DD)
- due_date: Due date / payment due date (format: YYYY-MM-DD). Look for phrases like "Please pay on May 7", "Payment due May 7", or "Due date: May 7" and convert to YYYY-MM-DD using the invoice year if no year is given.
- payment_terms: Payment terms text (e.g., "30 Days", "Net 30", "T/T 100% before shipment", "DUE DATE")
- total_amount: Final total amount (number only, no currency symbol)
- currency: Currency code (USD, HKD, EUR, etc.)
- po_number: Purchase Order number if present (format like PO000002_KEY or extract PO#2924)
- mpo_number: Material Purchase Order number (format like MPO015713 — extract from Customer PO field which may contain "TNF F26 JAN BUY_MPO15371_MDDC_...")
- brand: Brand name (The North Face, Under Armour, Vans, Columbia, etc.)
- brand_code: Brand code (TNF, UA, VNS, CSC, HH, BUR, etc.)
- season: Season code (like F26, S26, F25, etc.)
- ship_to: Ship to / delivery / consignee company and address. If the invoice shows two columns (e.g., "Delivery address" and "Invoice address"), extract ONLY the delivery address column, NOT the invoice address column.
- sold_to: Sold to / invoice / buyer company and address. If the invoice shows two columns (e.g., "Delivery address" and "Invoice address"), extract ONLY the invoice address column, NOT the delivery address column.
- qty_shipped: Total quantity shipped (sum of all line item quantities, or the total quantity field if explicitly stated)
- document_type: Type of document (INVOICE, PROFORMA, COMMERCIAL_INVOICE, CREDIT_NOTE, STATEMENT, DEBIT_NOTE). Default to INVOICE if not clear.
- bank_name: Bank name of the vendor's bank (e.g., "Standard Chartered Bank", "HSBC", "The Hongkong and Shanghai Banking Corporation Ltd")
- swift_code: SWIFT/BIC code of the vendor's bank (e.g., "SCBLHKHHXXX", "HSBCHKHHHKH")
- account_number: Bank account number of the vendor (e.g., "447-0-092572-7", "484-592449-838")
- subtotal: Sub-total / Net Amount before charges and tax (number only)
- bank_charges: Bank charge / Bank Charges / BANK CHARGE fee (number only, e.g., 30)
- tt_charge: Telegraphic Transfer / TT Charge / T/T Charges fee (number only)
- freight_charges: Freight / Freight Charge / Freight Cost / FREIGHT fee (number only)
- courier_charges: Courier Charge / Express Fee / Delivery Charge fee (number only)
- handling_fee: Handling Fee (number only)
- finance_surcharge: Finance Surcharge / Finance Charge — late payment surcharge (number only)
- tax_amount: VAT / Value Added Tax / GST / PPN / Tax / Sales Tax / Withholding Tax amount (number only)
- discount_amount: Discount / DISCOUNT / Less: Discount amount (number only)
- setup_charge: Setup Charge / Tooling Fee / Plate Charge (number only)
- sample_charge: Sample Charge / Proto Sample Development Fee (number only)
- min_order_charge: Minimum Charge / Min. Order Charge (number only)
- additional_charges: Any other charge not covered above (number only)
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
   - Regex: /MPO(\d+)/i
3. total_amount must be a NUMBER only (e.g. 37.94 not "$37.94")
4. For line_items: extract EVERY line item row from the invoice table. Each row has:
   - description (item description text)
   - quantity (number from Quantity/Qty column, e.g., 12900, 6075, 8300)
   - unit_price (number from Unit Price column)
   - total_amount (number from Amount/Total column)
   - item_code (item code if present, e.g., "SA10047935", "M5PG*")
   Do not skip line items. If quantity looks like a unit price, re-check the column.
5. For bank details: look for sections labeled "Bank Details", "Payment Information", "Remittance", "Beneficiary Bank", or similar. Extract bank_name, swift_code, and account_number from there.
6. For qty_shipped: if there is a total quantity field, use that. Otherwise, sum the quantities from all line items.
7. For document_type: check if the document says "INVOICE", "PROFORMA INVOICE", "COMMERCIAL INVOICE", "CREDIT NOTE", "STATEMENT", etc.
8. For charges: extract ALL charges separately. Look for lines labeled:
   - "Bank Charge", "Bank Charges", "BANK CHARGE" → bank_charges
   - "TT Charge", "T/T Charges", "Telegraphic Transfer Fee" → tt_charge
   - "Freight", "Freight Charge", "Freight Cost", "FREIGHT" → freight_charges
   - "Courier Charge", "Express Fee", "Delivery Charge" → courier_charges
   - "Handling Fee" → handling_fee
   - "Finance Surcharge", "Finance Charge" → finance_surcharge
   - "VAT", "Value Added Tax", "GST", "PPN", "Tax", "Sales Tax", "Withholding Tax" → tax_amount
   - "Discount", "DISCOUNT", "Less: Discount" → discount_amount
   - "Setup Charge", "Tooling Fee", "Plate Charge" → setup_charge
   - "Sample Charge", "Proto Sample Development Fee" → sample_charge
   - "Minimum Charge", "Min. Order Charge" → min_order_charge
   - Any other charge line → additional_charges
   Each charge must be a NUMBER only (e.g., 30 not "$30"). If a charge is 0.00, still extract it as 0.
9. For subtotal: extract the "Subtotal", "Sub-Total", "Sub Total", "Net Amount", or "NET INVOICE" line — this is the sum of line items BEFORE charges and tax.
10. If a field is not found, use null
11. Return ONLY the JSON object, nothing else

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
  "qty_shipped": 120,
  "document_type": "INVOICE",
  "bank_name": "Standard Chartered Bank",
  "swift_code": "SCBLHKHHXXX",
  "account_number": "447-0-092572-7",
  "subtotal": 32.94,
  "bank_charges": 30.00,
  "tt_charge": null,
  "freight_charges": null,
  "courier_charges": null,
  "handling_fee": null,
  "finance_surcharge": null,
  "tax_amount": 0.00,
  "discount_amount": null,
  "setup_charge": null,
  "sample_charge": null,
  "min_order_charge": null,
  "additional_charges": null,
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

export class OllamaOCRService {
  private static instance: OllamaOCRService;
  private baseUrl: string | null = null;
  private model: string = 'qwen3:4b';
  private timeout: number = 300000;
  private isConfigured: boolean = false;

  private constructor() {
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) {
      logger.warn('OLLAMA_BASE_URL not configured — Ollama OCR fallback disabled');
      return;
    }

    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = process.env.OLLAMA_MODEL || 'qwen3:4b';
    this.timeout = (Number(process.env.OLLAMA_TIMEOUT) || 300) * 1000;
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

      const MAX_OLLAMA_TEXT_LENGTH = Number(process.env.OLLAMA_MAX_TEXT_LENGTH) || 4000;
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
            num_ctx: 4096,
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
            num_ctx: 4096,
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
