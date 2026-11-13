import { logger } from '../utils/logger';
import { correctionLogService } from './correctionLogService';
import { formatClassificationFeedbackPrompt, getClassificationFeedbackExamples } from './classificationFeedbackService';
import { EXTRACTION_PROMPT } from './geminiOCRService';
import type { ExtractionContext } from './consensusExtractor';

export interface OpenAIExtractedLineItem {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_amount?: number | null;
  item_code?: string | null;
  size?: string | null;
  mpo_number?: string | null;
  po_number?: string | null;
}

export interface FieldEvidence {
  page?: number | null;
  snippet?: string | null;
  label_seen?: string | null;
}

export interface OpenAIExtractedInvoiceData {
  vendor_name?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  subtotal?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  po_number?: string | null;
  mpo_number?: string | null;
  brand?: string | null;
  brand_code?: string | null;
  season?: string | null;
  ship_to?: string | null;
  sold_to?: string | null;
  qty_shipped?: number | null;
  document_type?: string | null;
  document_type_evidence?: string | null;
  field_evidence?: { invoice_number?: FieldEvidence | null; total_amount?: FieldEvidence | null; invoice_date?: FieldEvidence | null } | null;
  payable_candidate?: boolean | null;
  model_name?: string;
  prompt_version?: string;
  beneficiary_name?: string | null;
  bank_name?: string | null;
  swift_code?: string | null;
  account_number?: string | null;
  bank_charges?: number | null;
  tt_charge?: number | null;
  freight_charges?: number | null;
  courier_charges?: number | null;
  handling_fee?: number | null;
  finance_surcharge?: number | null;
  tax_amount?: number | null;
  discount_amount?: number | null;
  setup_charge?: number | null;
  sample_charge?: number | null;
  min_order_charge?: number | null;
  additional_charges?: number | null;
  line_items?: OpenAIExtractedLineItem[] | null;
  signatures?: { signatory_name?: string | null; signatory_role?: string | null; signed_date?: string | null }[] | null;
  incoterm?: string | null;
  exchange_rate?: number | null;
  invoice_currency_original?: string | null;
  is_handwritten?: boolean | null;
  is_statement?: boolean | null;
  extraction_method?: string;
  engine_name?: string;
  confidence?: number;
}

const DOCUMENT_TYPES = [
  'INVOICE', 'SALES_INVOICE', 'PROFORMA_INVOICE', 'COMMERCIAL_INVOICE',
  'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PACKING_LIST', 'AIRWAY_BILL',
  'TECH_PACK', 'TRIM_RECEIPT', 'FAKTUR_PAJAK', 'FORWARDER_BILLING_INVOICE',
  'STATEMENT', 'UNKNOWN',
] as const;

const NUMBER_FIELDS = [
  'subtotal', 'total_amount', 'qty_shipped', 'bank_charges', 'tt_charge',
  'freight_charges', 'courier_charges', 'handling_fee', 'finance_surcharge',
  'tax_amount', 'discount_amount', 'setup_charge', 'sample_charge',
  'min_order_charge', 'additional_charges', 'exchange_rate',
] as const;

const FIELD_EVIDENCE_SCHEMA = {
  type: ['object', 'null'], additionalProperties: false,
  properties: {
    page: { type: ['integer', 'null'] },
    snippet: { type: ['string', 'null'] },
    label_seen: { type: ['string', 'null'] },
  },
  required: ['page', 'snippet', 'label_seen'],
} as const;

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    vendor_name: { type: ['string', 'null'] }, invoice_number: { type: ['string', 'null'] },
    invoice_date: { type: ['string', 'null'] }, due_date: { type: ['string', 'null'] },
    payment_terms: { type: ['string', 'null'] }, subtotal: { type: ['number', 'null'] },
    total_amount: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] },
    po_number: { type: ['string', 'null'] }, mpo_number: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] }, brand_code: { type: ['string', 'null'] },
    season: { type: ['string', 'null'] }, ship_to: { type: ['string', 'null'] },
    sold_to: { type: ['string', 'null'] }, qty_shipped: { type: ['number', 'null'] },
    document_type: { type: 'string', enum: [...DOCUMENT_TYPES] },
    document_type_evidence: { type: ['string', 'null'] }, payable_candidate: { type: ['boolean', 'null'] },
    field_evidence: { type: ['object', 'null'], additionalProperties: false, properties: {
      invoice_number: FIELD_EVIDENCE_SCHEMA,
      total_amount: FIELD_EVIDENCE_SCHEMA,
      invoice_date: FIELD_EVIDENCE_SCHEMA,
    }, required: ['invoice_number', 'total_amount', 'invoice_date'] },
    beneficiary_name: { type: ['string', 'null'] }, bank_name: { type: ['string', 'null'] },
    swift_code: { type: ['string', 'null'] }, account_number: { type: ['string', 'null'] },
    bank_charges: { type: ['number', 'null'] }, tt_charge: { type: ['number', 'null'] },
    freight_charges: { type: ['number', 'null'] }, courier_charges: { type: ['number', 'null'] },
    handling_fee: { type: ['number', 'null'] }, finance_surcharge: { type: ['number', 'null'] },
    tax_amount: { type: ['number', 'null'] }, discount_amount: { type: ['number', 'null'] },
    setup_charge: { type: ['number', 'null'] }, sample_charge: { type: ['number', 'null'] },
    min_order_charge: { type: ['number', 'null'] }, additional_charges: { type: ['number', 'null'] },
    line_items: {
      type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        description: { type: ['string', 'null'] }, quantity: { type: ['number', 'null'] },
        unit_price: { type: ['number', 'null'] }, total_amount: { type: ['number', 'null'] },
        item_code: { type: ['string', 'null'] }, size: { type: ['string', 'null'] },
        mpo_number: { type: ['string', 'null'] }, po_number: { type: ['string', 'null'] },
      }, required: ['description', 'quantity', 'unit_price', 'total_amount', 'item_code', 'size', 'mpo_number', 'po_number'] },
    },
    signatures: {
      type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        signatory_name: { type: ['string', 'null'] }, signatory_role: { type: ['string', 'null'] }, signed_date: { type: ['string', 'null'] },
      }, required: ['signatory_name', 'signatory_role', 'signed_date'] },
    },
    incoterm: { type: ['string', 'null'] }, exchange_rate: { type: ['number', 'null'] },
    invoice_currency_original: { type: ['string', 'null'] }, is_handwritten: { type: ['boolean', 'null'] },
    is_statement: { type: ['boolean', 'null'] },
  },
  required: [
    'vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'payment_terms', 'subtotal', 'total_amount', 'currency',
    'po_number', 'mpo_number', 'brand', 'brand_code', 'season', 'ship_to', 'sold_to', 'qty_shipped', 'document_type',
    'document_type_evidence', 'payable_candidate', 'field_evidence', 'beneficiary_name', 'bank_name', 'swift_code', 'account_number',
    'bank_charges', 'tt_charge', 'freight_charges', 'courier_charges', 'handling_fee', 'finance_surcharge', 'tax_amount',
    'discount_amount', 'setup_charge', 'sample_charge', 'min_order_charge', 'additional_charges', 'line_items', 'signatures',
    'incoterm', 'exchange_rate', 'invoice_currency_original', 'is_handwritten', 'is_statement',
  ],
} as const;

export class OpenAIOCRService {
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly pdfDetail: 'auto' | 'low' | 'high';

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY?.trim() || null;
    this.model = process.env.OPENAI_OCR_MODEL?.trim() || 'gpt-6-astra';
    this.timeoutMs = Math.max(10_000, Number(process.env.OPENAI_OCR_TIMEOUT_MS) || 120_000);
    const detail = process.env.OPENAI_OCR_PDF_DETAIL;
    this.pdfDetail = detail === 'low' || detail === 'high' ? detail : 'auto';
    if (this.isAvailable()) logger.info(`OpenAI OCR service initialized with model ${this.model}`);
    else logger.warn('OPENAI_API_KEY not configured or OPENAI_OCR_ENABLED=false — OpenAI OCR disabled');
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && process.env.OPENAI_OCR_ENABLED !== 'false');
  }

  private async request(payload: Record<string, unknown>): Promise<any | null> {
    if (!this.apiKey) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.error(`[OpenAI OCR] API returned ${response.status}: ${body.slice(0, 300)}`);
        return null;
      }
      return await response.json();
    } catch (error) {
      logger.error('[OpenAI OCR] request failed:', error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseResponse(data: any): OpenAIExtractedInvoiceData | null {
    if (!data || data.status === 'incomplete') return null;
    const outputText = typeof data.output_text === 'string'
      ? data.output_text
      : (data.output || []).flatMap((item: any) => item?.content || [])
        .filter((part: any) => typeof part?.text === 'string')
        .map((part: any) => part.text).join('');
    if (!outputText) return null;
    let parsed: OpenAIExtractedInvoiceData;
    try {
      parsed = JSON.parse(outputText) as OpenAIExtractedInvoiceData;
    } catch {
      const match = outputText.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { parsed = JSON.parse(match[0]) as OpenAIExtractedInvoiceData; } catch { return null; }
    }
    for (const field of NUMBER_FIELDS) {
      const value = (parsed as any)[field];
      if (value !== null && value !== undefined) {
        const number = Number(value);
        (parsed as any)[field] = Number.isFinite(number) ? number : null;
      }
    }
    if (Array.isArray(parsed.line_items)) {
      parsed.line_items = parsed.line_items.map(item => ({
        ...item,
        quantity: item.quantity == null ? null : Number(item.quantity),
        unit_price: item.unit_price == null ? null : Number(item.unit_price),
        total_amount: item.total_amount == null ? null : Number(item.total_amount),
      }));
    }
    parsed.extraction_method = 'openai-responses';
    parsed.engine_name = 'openai';
    parsed.model_name = this.model;
    parsed.prompt_version = process.env.OPENAI_OCR_PROMPT_VERSION || 'invoice-extraction-v1';
    parsed.confidence = this.calculateConfidence(parsed);
    return parsed;
  }

  private calculateConfidence(result: OpenAIExtractedInvoiceData): number {
    let score = 0;
    if (result.vendor_name) score += 25;
    if (result.invoice_number) score += 20;
    if (result.total_amount && result.total_amount > 0) score += 25;
    if (result.invoice_date) score += 10;
    if (result.currency) score += 5;
    if (result.line_items?.length) score += 5;
    if (result.document_type && result.document_type !== 'UNKNOWN') score += 10;
    return Math.min(1, score / 100);
  }

  async extractFromFile(fileBuffer: Buffer, mimeType = 'application/pdf', context?: ExtractionContext): Promise<OpenAIExtractedInvoiceData | null> {
    if (!this.isAvailable() || !fileBuffer.length) return null;
    const normalizedMime = mimeType.toLowerCase();
    const isImage = normalizedMime.startsWith('image/');
    const base64 = fileBuffer.toString('base64');
    const [fewShot, classificationExamples] = context
      ? await Promise.all([
        correctionLogService.getFewShotPrompt('', context.vendorName, context.invoiceTemplateType),
        getClassificationFeedbackExamples(context.vendorName),
      ])
      : ['', []];
    const classificationFeedback = formatClassificationFeedbackPrompt(classificationExamples);
    const prompt = `${fewShot ? `${fewShot}\n\n` : ''}${classificationFeedback ? `${classificationFeedback}\n\n` : ''}${EXTRACTION_PROMPT}\n\nFor invoice_number, total_amount, and invoice_date, also return field_evidence: page number (1-based), a short exact snippet from that page, and the nearby printed label. Return null for evidence components you cannot read; never invent a page, snippet, or label. Keep the normal flattened field values unchanged. HEADER CLASSIFICATION IS MANDATORY: use the visible first-page title and document purpose; return UNKNOWN when unreadable. Never default to INVOICE. Reviewer examples are supporting evidence only and must not override this file's visible content. The rule engine will decide final routing.`;
    const content: any[] = [{ type: 'input_text', text: prompt }];
    if (isImage) {
      content.push({ type: 'input_image', image_url: `data:${normalizedMime};base64,${base64}`, detail: 'high' });
    } else {
      content.push({ type: 'input_file', filename: 'invoice.pdf', file_data: `data:application/pdf;base64,${base64}`, detail: this.pdfDetail });
    }
    const response = await this.request({
      model: this.model,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'madison88_invoice_extraction', strict: true, schema: EXTRACTION_SCHEMA } },
      max_output_tokens: 8000,
    });
    const result = this.parseResponse(response);
    if (result) logger.info(`[OpenAI OCR] extracted vendor=${result.vendor_name || ''}, invoice#=${result.invoice_number || ''}, amount=${result.total_amount ?? ''}, type=${result.document_type || 'UNKNOWN'}`);
    return result;
  }
}

export const openaiOCRService = new OpenAIOCRService();
