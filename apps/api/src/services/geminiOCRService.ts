import { GoogleGenerativeAI } from '@google/generative-ai';
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

export interface ExtractedSignature {
  signatory_name: string;
  signatory_role?: string;
  signed_date?: string;
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
  signatures?: ExtractedSignature[];
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
- po_number: Purchase Order number if present (format like PO000002_KEY)
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
- signatures: Array of signatures/stamps found on the document. Look for:
  - Printed or handwritten names near "Signature", "Signed by", "Authorized by", "Approved by", "Prepared by", "For and on behalf of" sections
  - Stamped names or company stamps
  - Any name that appears to be a signatory/approver
  - Known signatory names: Sarah Jane Cariquitan, MJ Santiago, Maricon Alvarez, April Joy Diasanta, Pamela Amor Caoili, Mariane Eusebio, Mary Joy Yco, Maricar Tanaleon, Mary Ann Del Monte, Edwin Garcia, Glecie Yumena, Lindsey Schindler
  - "Computer generated invoice, no signature required" → no signatures needed, skip
  Each signature should have:
  - signatory_name: The person's name as printed/signed on the document
  - signatory_role: Their role if stated (e.g., "Coordinator", "Purchasing Manager", "Account Holder", "Sr. Manager", "Planning Manager")
  - signed_date: Date next to the signature if present (format: YYYY-MM-DD), null if not found
  Extract ALL signatures visible on the document, even if only partially readable.
- incoterm: International trade term (EXW, DAP, FOB, CIF, DDP, CFR, FCA, CPT, CIP). Look for "Incoterm", "Trade Terms" labels or standalone 3-letter codes.
- exchange_rate: Exchange rate if mentioned (e.g., "@7.70" or "Exchange Rate: 7.70" or "settle in USD @7.70"). Number only.
- invoice_currency_original: Original currency if different from settlement currency (e.g., invoice in HKD but settle in USD).
- is_handwritten: true if the invoice appears to be handwritten or has very low text density (less than 200 characters). Common for small suppliers like "Kabuhayan Namin".
- is_statement: true if the document is a statement/account statement/aging report rather than an invoice (e.g., SF Express statements). These have "STATEMENT", "Account Statement", "Aging", "Outstanding Balance", "Current Charges" labels.

IMPORTANT RULES:
1. vendor_name is the SENDER of the invoice, NOT Madison 88
2. For mpo_number: look in "Customer PO", "CUSTOMER PO", "PO Number", "Customer PO No", or "Order No" field
   - Pattern: "TNF F26 JAN BUY_MPO15371_MDDC_..." → extract "MPO15371"
   - Pattern: "MPO015713" → extract "MPO015713"
   - Pattern: "MPO15767" → extract "MPO15767"
   - Pattern: just "15767" in Customer PO field → extract "MPO15767"
   - Regex: /MPO(\d+)/i or if only digits found, prefix with "MPO"
   - If no MPO number is found, return null (do NOT make one up)
3. total_amount must be a NUMBER only (e.g. 37.94 not "$37.94")
4. For line_items: extract EVERY line item row from the invoice table. Each row has:
   - description (item description text)
   - quantity (number from Quantity/Qty column, e.g., 12900, 6075, 8300)
   - unit_price (number from Unit Price column)
   - total_amount (number from Amount/Total column)
   - item_code (item code if present, e.g., "SA10047935", "M5PG*")
   Do not skip line items. If quantity looks like a unit price, re-check the column.
5. For bank details: look for sections labeled "Bank Details", "Payment Information", "Remittance", "Beneficiary Bank", or similar. Extract bank_name, swift_code, and account_number from there.
6. For qty_shipped: if there is a total quantity field (e.g., "Total Qty", "Total Quantity", "Total PCS"), use that. Otherwise, sum the quantities from all line items. Always return as a number, never null if any quantity info exists.
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
  ],
  "signatures": [
    {
      "signatory_name": "Jane Doe",
      "signatory_role": "Coordinator",
      "signed_date": "2026-05-07"
    }
  ],
  "incoterm": "EXW",
  "exchange_rate": null,
  "invoice_currency_original": null,
  "is_handwritten": false,
  "is_statement": false
}

Invoice text to extract from:
`;

export class GeminiOCRService {
  private static instance: GeminiOCRService;
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private isConfigured: boolean = false;

  private constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn('GEMINI_API_KEY not configured — Gemini OCR fallback disabled');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      });
      this.isConfigured = true;
      logger.info('Gemini OCR service initialized');
    } catch (error) {
      logger.error('Failed to initialize Gemini OCR:', error);
    }
  }

  static getInstance(): GeminiOCRService {
    if (!GeminiOCRService.instance) {
      GeminiOCRService.instance = new GeminiOCRService();
    }
    return GeminiOCRService.instance;
  }

  isAvailable(): boolean {
    return this.isConfigured;
  }

  async extractFromText(
    rawText: string,
    context?: ExtractionContext
  ): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || !this.model) {
      logger.warn('Gemini OCR not configured — skipping fallback');
      return null;
    }

    try {
      logger.info('Gemini OCR fallback triggered — extracting invoice data');

      // Truncate text if too long (Gemini has token limits)
      const MAX_GEMINI_TEXT_LENGTH = Number(process.env.GEMINI_MAX_TEXT_LENGTH) || 8000;
      const truncatedText = rawText.length > MAX_GEMINI_TEXT_LENGTH
        ? rawText.substring(0, MAX_GEMINI_TEXT_LENGTH) + '\n[TEXT TRUNCATED]'
        : rawText;

      const fewShot = context
        ? await correctionLogService.getFewShotPrompt(rawText, context.vendorName, context.invoiceTemplateType)
        : '';

      const prompt = (fewShot ? fewShot + '\n\n' : '') + EXTRACTION_PROMPT + truncatedText;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON response
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

        // FIX: Try to extract JSON object from malformed response
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.error('No JSON object found in Gemini response');
          return null;
        }

        try {
          extracted = JSON.parse(jsonMatch[0]) as ExtractedInvoiceData;
          logger.info('JSON recovery successful for Gemini response');
        } catch (recoveryError) {
          logger.error('JSON recovery failed:', {
            error: recoveryError instanceof Error ? recoveryError.message : 'unknown',
          });
          return null;
        }
      }

      // Validate and clean numbers
      if (extracted.total_amount) {
        extracted.total_amount = Number(extracted.total_amount);
        if (isNaN(extracted.total_amount)) extracted.total_amount = undefined;
      }

      // Clean line item numbers
      if (extracted.line_items) {
        extracted.line_items = extracted.line_items.map(li => ({
          ...li,
          quantity: Number(li.quantity) || 0,
          unit_price: Number(li.unit_price) || 0,
          total_amount: Number(li.total_amount) || 0,
        }));
      }

      extracted.extraction_method = 'gemini-fallback';
      extracted.engine_name = 'gemini';
      extracted.confidence = this.calculateConfidence(extracted);

      logger.info(`Gemini OCR extracted: vendor=${extracted.vendor_name}, amount=${extracted.total_amount}, confidence=${extracted.confidence}`);

      return extracted;
    } catch (error) {
      logger.error('Gemini OCR extraction failed:', error);
      console.error('[GeminiOCRService] extractFromText failed:', error);
      return null;
    }
  }

  async extractFromPDF(pdfBuffer: Buffer, vendorName?: string): Promise<ExtractedInvoiceData | null> {
    if (!this.isConfigured || !this.model) {
      return null;
    }

    try {
      logger.info('Gemini Vision OCR — processing PDF as file');

      const base64PDF = pdfBuffer.toString('base64');

      // Fetch few-shot corrections to improve extraction accuracy
      let fewShot = '';
      try {
        fewShot = await correctionLogService.getFewShotPrompt('', vendorName, undefined, 3);
        if (fewShot) {
          logger.info('Gemini Vision OCR — using few-shot corrections for better accuracy');
        }
      } catch {
        // Non-critical, continue without few-shot
      }

      const prompt = (fewShot ? fewShot + '\n\n' : '') + EXTRACTION_PROMPT + '\n[PDF provided as file above — extract all invoice data]';

      const result = await this.model.generateContent([
        {
          inlineData: {
            data: base64PDF,
            mimeType: 'application/pdf',
          },
        },
        prompt,
      ]);

      const response = await result.response;
      const text = response.text();

      const cleaned = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const extracted = JSON.parse(cleaned) as ExtractedInvoiceData;
      extracted.extraction_method = 'gemini-vision-fallback';
      extracted.engine_name = 'gemini';
      extracted.confidence = this.calculateConfidence(extracted);

      return extracted;
    } catch (error) {
      logger.error('Gemini Vision OCR failed:', error);
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

export const geminiOCRService = GeminiOCRService.getInstance();
