import { logger } from '../utils/logger';

/**
 * Upstage OCR Service
 * Uses Upstage Information Extraction API to directly extract structured invoice fields from PDFs.
 * This is a single-step approach — no separate OCR + AI needed.
 *
 * API docs: https://console.upstage.ai/api/docs
 * Endpoint: POST https://api.upstage.ai/v1/information-extraction
 * Rate limits (Tier 0): 1 RPS, 300 PPM
 */

interface UpstageLineItem {
  description?: string;
  quantity?: string;
  unit_price?: string;
  total_amount?: string;
  item_code?: string;
  size?: string;
  mpo_number?: string;
  po_number?: string;
}

interface UpstageSignature {
  signatory_name?: string;
  signatory_role?: string;
  signed_date?: string;
}

interface UpstageExtractedData {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  payment_terms?: string;
  total_amount?: string;
  currency?: string;
  po_number?: string;
  mpo_number?: string;
  brand?: string;
  brand_code?: string;
  season?: string;
  ship_to?: string;
  sold_to?: string;
  qty_shipped?: string;
  document_type?: string;
  beneficiary_name?: string;
  bank_name?: string;
  swift_code?: string;
  account_number?: string;
  subtotal?: string;
  bank_charges?: string;
  tt_charge?: string;
  freight_charges?: string;
  courier_charges?: string;
  handling_fee?: string;
  finance_surcharge?: string;
  tax_amount?: string;
  discount_amount?: string;
  setup_charge?: string;
  sample_charge?: string;
  min_order_charge?: string;
  additional_charges?: string;
  incoterm?: string;
  exchange_rate?: string;
  is_handwritten?: string;
  is_statement?: string;
  line_items?: UpstageLineItem[];
  signatures?: UpstageSignature[];
}

// Schema for Upstage Information Extraction API
// Note: first-level properties must be string/integer/number/array (no objects at first level)
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    vendor_name: { type: 'string', description: 'Company name of the vendor/supplier (NOT Madison 88 — they are the buyer)' },
    invoice_number: { type: 'string', description: 'Invoice number or reference' },
    invoice_date: { type: 'string', description: 'Date of invoice (YYYY-MM-DD)' },
    due_date: { type: 'string', description: 'Due date / payment due date (YYYY-MM-DD). Look for "Please pay on", "Payment due", "Due date"' },
    payment_terms: { type: 'string', description: 'Payment terms text (e.g. Net 30, T/T 100% before shipment)' },
    total_amount: { type: 'string', description: 'Final total amount (number only, no currency symbol)' },
    currency: { type: 'string', description: 'Currency code (USD, HKD, EUR, etc.)' },
    po_number: { type: 'string', description: 'Purchase Order number (e.g. PO000002_KEY or PO#2924)' },
    mpo_number: { type: 'string', description: 'Material Purchase Order number (e.g. MPO015713). Extract from Customer PO field' },
    brand: { type: 'string', description: 'Brand name (The North Face, Under Armour, Vans, Columbia, etc.)' },
    brand_code: { type: 'string', description: 'Brand code (TNF, UA, VNS, CSC, HH, BUR, etc.)' },
    season: { type: 'string', description: 'Season code (F26, S26, F25, etc.)' },
    ship_to: { type: 'string', description: 'Ship to / delivery address. If two columns, extract ONLY delivery address' },
    sold_to: { type: 'string', description: 'Sold to / invoice address. If two columns, extract ONLY invoice address' },
    qty_shipped: { type: 'string', description: 'Total quantity shipped (sum of line items or total qty field)' },
    document_type: { type: 'string', description: 'INVOICE, PROFORMA, COMMERCIAL_INVOICE, CREDIT_NOTE, STATEMENT, DEBIT_NOTE' },
    beneficiary_name: { type: 'string', description: 'Beneficiary / account holder name' },
    bank_name: { type: 'string', description: 'Bank name of vendor bank' },
    swift_code: { type: 'string', description: 'SWIFT/BIC code' },
    account_number: { type: 'string', description: 'Bank account number' },
    subtotal: { type: 'string', description: 'Sub-total before charges and tax (number only)' },
    bank_charges: { type: 'string', description: 'Bank charge fee (number only)' },
    tt_charge: { type: 'string', description: 'Telegraphic Transfer charge (number only)' },
    freight_charges: { type: 'string', description: 'Freight charge (number only)' },
    courier_charges: { type: 'string', description: 'Courier charge (number only)' },
    handling_fee: { type: 'string', description: 'Handling fee (number only)' },
    finance_surcharge: { type: 'string', description: 'Finance surcharge (number only)' },
    tax_amount: { type: 'string', description: 'VAT/GST/Tax amount (number only)' },
    discount_amount: { type: 'string', description: 'Discount amount (number only)' },
    setup_charge: { type: 'string', description: 'Setup charge (number only)' },
    sample_charge: { type: 'string', description: 'Sample charge (number only)' },
    min_order_charge: { type: 'string', description: 'Minimum order charge (number only)' },
    additional_charges: { type: 'string', description: 'Any other charge (number only)' },
    incoterm: { type: 'string', description: 'Trade term (EXW, DAP, FOB, CIF, DDP, CFR, FCA)' },
    exchange_rate: { type: 'string', description: 'Exchange rate if mentioned (number only)' },
    is_handwritten: { type: 'string', description: 'true if handwritten' },
    is_statement: { type: 'string', description: 'true if statement not invoice' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Item description' },
          quantity: { type: 'string', description: 'Quantity as number' },
          unit_price: { type: 'string', description: 'Unit price as number' },
          total_amount: { type: 'string', description: 'Line total as number' },
          item_code: { type: 'string', description: 'Item code if present' },
          size: { type: 'string', description: 'Size if present (S, M, L, XL, etc.)' },
          mpo_number: { type: 'string', description: 'MPO for this specific line' },
          po_number: { type: 'string', description: 'PO for this specific line' },
        },
      },
    },
    signatures: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          signatory_name: { type: 'string', description: 'Person name as printed/signed' },
          signatory_role: { type: 'string', description: 'Role if stated' },
          signed_date: { type: 'string', description: 'Date next to signature (YYYY-MM-DD)' },
        },
      },
    },
  },
  required: ['vendor_name', 'invoice_number', 'total_amount'],
};

export class UpstageOCRService {
  private static instance: UpstageOCRService;
  private apiKey: string | null = null;
  private baseUrl: string = 'https://api.upstage.ai/v1';
  private isConfigured: boolean = false;

  private constructor() {
    const apiKey = process.env.UPSTAGE_API_KEY;
    if (!apiKey) {
      logger.warn('UPSTAGE_API_KEY not configured — Upstage OCR fallback disabled');
      return;
    }
    this.apiKey = apiKey;
    this.baseUrl = process.env.UPSTAGE_BASE_URL || 'https://api.upstage.ai/v1';
    this.isConfigured = true;
    logger.info('Upstage OCR service initialized');
  }

  static getInstance(): UpstageOCRService {
    if (!UpstageOCRService.instance) {
      UpstageOCRService.instance = new UpstageOCRService();
    }
    return UpstageOCRService.instance;
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  /**
   * Extract invoice fields directly from a PDF file buffer using Upstage Information Extraction API.
   * This is a single-step approach — no separate OCR needed.
   */
  async extractFromPDF(fileBuffer: Buffer): Promise<UpstageExtractedData | null> {
    if (!this.isConfigured || !this.apiKey) {
      logger.warn('Upstage OCR not configured — skipping');
      return null;
    }

    const start = Date.now();

    try {
      logger.info('Upstage Info Extraction — extracting invoice data from PDF...');

      const base64Data = fileBuffer.toString('base64');

      const requestBody = {
        model: 'information-extract',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/octet-stream;base64,${base64Data}`,
                },
              },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'invoice_schema',
            schema: INVOICE_SCHEMA,
          },
        },
      };

      const response = await fetch(`${this.baseUrl}/information-extraction`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`Upstage IE HTTP ${response.status}: ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const elapsed = Date.now() - start;

      // Parse the extracted JSON from response
      const content = data.choices?.[0]?.message?.content || '';
      if (!content) {
        logger.warn('Upstage IE returned empty content');
        return null;
      }

      let extracted: UpstageExtractedData;
      try {
        extracted = JSON.parse(content) as UpstageExtractedData;
      } catch {
        // Try to extract JSON from malformed response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('Upstage IE: no JSON found in response');
          return null;
        }
        try {
          extracted = JSON.parse(jsonMatch[0]) as UpstageExtractedData;
        } catch (recoveryError) {
          logger.error('Upstage IE JSON recovery failed:', recoveryError);
          return null;
        }
      }

      const usage = data.usage || {};
      const fieldsCount = Object.keys(extracted).filter(k => {
        const v = (extracted as any)[k];
        return v && v !== '' && !(Array.isArray(v) && v.length === 0);
      }).length;

      logger.info(
        `Upstage IE succeeded — ${elapsed}ms, ${fieldsCount} fields, ` +
        `tokens: prompt=${usage.prompt_tokens || '?'}, completion=${usage.completion_tokens || '?'}, ` +
        `vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}", amount: ${extracted.total_amount}`
      );

      return extracted;
    } catch (error) {
      logger.error('Upstage IE extraction failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Extract text from a PDF using Upstage Document OCR API.
   * Returns raw text + confidence — useful as a text extraction alternative.
   */
  async extractText(fileBuffer: Buffer): Promise<{ text: string; confidence: number; pages: number } | null> {
    if (!this.isConfigured || !this.apiKey) {
      return null;
    }

    try {
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      const buffers: Buffer[] = [];

      // model field
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nocr\r\n`,
        'utf8'
      ));
      // document field (file)
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="invoice.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        'utf8'
      ));
      buffers.push(fileBuffer);
      buffers.push(Buffer.from('\r\n', 'utf8'));
      // closing boundary
      buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

      const body = Buffer.concat(buffers);

      const response = await fetch(`${this.baseUrl}/document-digitization`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`Upstage Doc OCR HTTP ${response.status}: ${errText}`);
        return null;
      }

      const data = await response.json() as any;
      const text = data.text || '';
      const confidence = data.confidence || 0;
      const pages = data.numBilledPages || (data.pages ? data.pages.length : 0);

      logger.info(`Upstage Doc OCR succeeded — ${text.length} chars, confidence: ${confidence}, ${pages} pages`);
      return { text, confidence, pages };
    } catch (error) {
      logger.error('Upstage Doc OCR failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Parse a PDF using Upstage Document Parse API.
   * Returns structured text (markdown/html) with layout detection.
   */
  async parseDocument(fileBuffer: Buffer): Promise<{ text: string; markdown: string } | null> {
    if (!this.isConfigured || !this.apiKey) {
      return null;
    }

    try {
      const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
      const buffers: Buffer[] = [];

      // model field
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ndocument-parse\r\n`,
        'utf8'
      ));
      // output_formats field
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="output_formats"\r\n\r\n["text", "markdown"]\r\n`,
        'utf8'
      ));
      // ocr field
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="ocr"\r\n\r\nforce\r\n`,
        'utf8'
      ));
      // coordinates field
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="coordinates"\r\n\r\nfalse\r\n`,
        'utf8'
      ));
      // document field (file)
      buffers.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="invoice.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        'utf8'
      ));
      buffers.push(fileBuffer);
      buffers.push(Buffer.from('\r\n', 'utf8'));
      // closing boundary
      buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

      const body = Buffer.concat(buffers);

      const response = await fetch(`${this.baseUrl}/document-digitization`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.error(`Upstage Doc Parse HTTP ${response.status}: ${errText}`);
        return null;
      }

      const data = await response.json() as any;

      // Extract text from response — handle various response formats
      let text = '';
      let markdown = '';

      if (data.content) {
        text = data.content.text || '';
        markdown = data.content.markdown || '';
      }
      if (!text && data.text) text = data.text;
      if (!text && data.elements) {
        text = data.elements.map((el: any) => el.text || el.html || el.markdown || '').filter(Boolean).join('\n');
      }
      if (!text && data.results) {
        text = data.results.map((r: any) => r.text || r.markdown || r.html || '').filter(Boolean).join('\n');
      }

      logger.info(`Upstage Doc Parse succeeded — ${text.length} chars`);
      return { text, markdown };
    } catch (error) {
      logger.error('Upstage Doc Parse failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}

export const upstageOCRService = UpstageOCRService.getInstance();
