import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { InvoiceType, InvoiceCategory, PaymentTerms, MadisonEntity, OrderType } from '@ap-invoice/shared';

const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT || '';
const apiKey = process.env.AZURE_FORM_RECOGNIZER_KEY || '';

if (!endpoint || !apiKey) {
  console.warn('Azure Form Recognizer credentials not configured');
}

const client = endpoint && apiKey 
  ? new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey))
  : null;

export interface BankInfo {
  bank_name?: string;
  swift_code?: string;
  bank_code?: string;
  iban?: string;
  sort_code?: string;
  aba_routing_number?: string;
  account_usd?: string;
  account_hkd?: string;
  account_eur?: string;
  account_idr?: string;
  account_inr?: string;
  account_vnd?: string;
  account_name?: string;
  bank_address?: string;
  intermediary_bank_name?: string;
  intermediary_bank_swift?: string;
}

export interface SignatureInfo {
  signer_name: string;
  signed_at?: Date;
  role: string;
  is_digital: boolean;
}

export interface OCRResult {
  invoice_number: string;
  invoice_date: Date;
  due_date?: Date;
  invoice_received_date?: Date;
  date_range_start?: Date;
  date_range_end?: Date;
  invoice_version?: string;
  invoice_version_notes?: string;
  parent_invoice_id?: string;
  vendor_name: string;
  amount: number;
  amount_original?: number;
  currency_original?: string;
  exchange_rate_to_usd?: number;
  currency: string;
  payment_terms: PaymentTerms;
  payment_term_split?: string;
  incoterm?: string;
  bank_charges: number;
  shipping_charges: number;
  customs_charges: number;
  documentation_charges: number;
  surcharges: number;
  invoice_type: InvoiceType;
  category: InvoiceCategory;
  order_type?: OrderType;
  brand?: string;
  season?: string;
  mpo_number?: string;
  po_number?: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_entity?: MadisonEntity;
  is_handwritten: boolean;
  is_priority: boolean;
  priority_pay_date?: Date;
  payment_consolidation_note?: string;
  qb_memo?: string;
  qb_account_class?: string;
  bank_info: BankInfo;
  signatures: SignatureInfo[];
  raw_data: any;
}

// Advanced date parsing for all formats seen across 42 invoices
function parseDate(dateString: string): Date {
  if (!dateString) return new Date();
  
  const upperDate = dateString.toUpperCase();
  
  // Month name mappings
  const monthNames: Record<string, number> = { JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5, JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11, JAN: 0, FEB: 1, MAR: 2, APR: 3, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  
  // DD/MM/YYYY
  const ddmmyyyy = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  }
  
  // MM/DD/YYYY
  const mmddyyyy = dateString.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    return new Date(parseInt(mmddyyyy[3]), parseInt(mmddyyyy[1]) - 1, parseInt(mmddyyyy[2]));
  }
  
  // YYYY/MM/DD
  const yyyymmdd = dateString.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yyyymmdd) {
    return new Date(parseInt(yyyymmdd[1]), parseInt(yyyymmdd[2]) - 1, parseInt(yyyymmdd[3]));
  }
  
  // YYYY-MM-DD
  const yyyymmddDash = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmddDash) {
    return new Date(parseInt(yyyymmddDash[1]), parseInt(yyyymmddDash[2]) - 1, parseInt(yyyymmddDash[3]));
  }
  
  // DD-MMM-YYYY (29-DEC-2025)
  const ddmmmyyyy = dateString.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (ddmmmyyyy) {
    return new Date(parseInt(ddmmmyyyy[3]), monthNames[ddmmmyyyy[2].toUpperCase()], parseInt(ddmmmyyyy[1]));
  }
  
  // DD MMM YYYY (19 JAN, 2026)
  const ddmmmyyyySpace = dateString.match(/^(\d{1,2})\s+([A-Z]{3})\s*,?\s*(\d{4})$/i);
  if (ddmmmyyyySpace) {
    return new Date(parseInt(ddmmmyyyySpace[3]), monthNames[ddmmmyyyySpace[2].toUpperCase()], parseInt(ddmmmyyyySpace[1]));
  }
  
  // YYMMDD (260114 → 2026-01-14)
  const yymmdd = dateString.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (yymmdd && dateString.length === 6) {
    const year = parseInt(yymmdd[1]);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return new Date(fullYear, parseInt(yymmdd[2]) - 1, parseInt(yymmdd[3]));
  }
  
  // YYYY.MM.DD (2026.01.06)
  const yyyymmddDot = dateString.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (yyyymmddDot) {
    return new Date(parseInt(yyyymmddDot[1]), parseInt(yyyymmddDot[2]) - 1, parseInt(yyyymmddDot[3]));
  }
  
  // DD/MMM/YY (30/Apr/26)
  const ddmmmyy = dateString.match(/^(\d{1,2})\/([A-Z]{3})\/(\d{2})$/i);
  if (ddmmmyy) {
    const year = parseInt(ddmmmyy[3]);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return new Date(fullYear, monthNames[ddmmmyy[2].toUpperCase()], parseInt(ddmmmyy[1]));
  }
  
  // "April 06,26"
  const monthDayYear = dateString.match(/^([A-Z]{3,9})\s+(\d{1,2}),\s*(\d{2})$/i);
  if (monthDayYear) {
    const year = parseInt(monthDayYear[3]);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return new Date(fullYear, monthNames[monthDayYear[1].toUpperCase()], parseInt(monthDayYear[2]));
  }
  
  // "24-Feb-26"
  const ddmmmyyDash = dateString.match(/^(\d{1,2})-([A-Z]{3})-(\d{2})$/i);
  if (ddmmmyyDash) {
    const year = parseInt(ddmmmyyDash[3]);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return new Date(fullYear, monthNames[ddmmmyyDash[2].toUpperCase()], parseInt(ddmmmyyDash[1]));
  }
  
  // Default to standard parsing
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// Normalize SWIFT code according to BRD specifications
function normalizeSwiftCode(swift: string): string {
  if (!swift) return '';
  
  let normalized = swift.toUpperCase().replace(/\s/g, '');
  
  // "HSBCHKHHHKH" (11-char) → keep as-is (valid BIC11)
  if (normalized.length === 11) return normalized;
  
  // "HSBC HKH HHKH" (spaces) → "HSBCHKHHHKH"
  // Already handled by removing spaces
  
  // "DHBKHKHH" / "DHBKHKHHXXX" → store as "DHBKHKHH" (BIC8)
  if (normalized.startsWith('DHBKHKHH')) return 'DHBKHKHH';
  
  // "CITIHKHXXXX" (4 X) → "CITIHKHXXX" (BIC11 standard)
  if (normalized.endsWith('XXXX')) {
    return normalized.substring(0, normalized.length - 4) + 'XXX';
  }
  
  // "VBAAVNVX 650" → "VBAAVNVX" (strip branch suffix)
  const branchMatch = normalized.match(/^([A-Z]{8})\s*\d+$/);
  if (branchMatch) return branchMatch[1];
  
  // "IRVT US 3NXXX" → "IRVTUS3N"
  normalized = normalized.replace(/[^A-Z0-9]/g, '');
  if (normalized.length > 8) {
    return normalized.substring(0, 8);
  }
  
  return normalized;
}

// Detect invoice type from header text
function detectInvoiceType(fullText: string): InvoiceType {
  const upperText = fullText.toUpperCase();
  
  if (upperText.includes('PROFORMA INVOICE') || upperText.includes('PRO-FORMA') || upperText.includes('PI NO.')) {
    return InvoiceType.PI;
  }
  
  if (upperText.includes('COMMERCIAL INVOICE')) {
    return InvoiceType.CI;
  }
  
  if (upperText.includes('SALES INVOICE')) {
    return InvoiceType.SI;
  }
  
  if (upperText.includes('STATEMENT') || upperText.includes('MONTHLY STATEMENT')) {
    return InvoiceType.STATEMENT;
  }
  
  if (upperText.includes('PREPAID')) {
    return InvoiceType.PREPAID;
  }
  
  // Default to INV
  return InvoiceType.INV;
}

// Detect payment terms according to BRD specifications
function detectPaymentTerms(fullText: string): PaymentTerms {
  const upperText = fullText.toUpperCase();
  
  if (upperText.includes('NET 30') || upperText.includes('30 DAYS') || upperText.includes('30 HARI')) {
    return PaymentTerms.NET_30;
  }
  
  if (upperText.includes('NET 60')) {
    return PaymentTerms.NET_60;
  }
  
  if (upperText.includes('NET 90')) {
    return PaymentTerms.NET_90;
  }
  
  if (upperText.includes('PAYMENT IN ADVANCE') || upperText.includes('C-T.T IN ADVANCE')) {
    return PaymentTerms.PAYMENT_IN_ADVANCE;
  }
  
  if (upperText.includes('T/T 100%') || upperText.includes('100% BEFORE SHIPMENT') || upperText.includes('100% BEFORE SHIPMENT')) {
    return PaymentTerms.TT_100_BEFORE_SHIPMENT;
  }
  
  if (upperText.includes('PBS')) {
    return PaymentTerms.PBS;
  }
  
  if (upperText.includes('ARD')) {
    return PaymentTerms.ARD;
  }
  
  if (upperText.includes('CK 30 NET') || upperText.includes('CHEQUE 30')) {
    return PaymentTerms.CHEQUE_30;
  }
  
  if (upperText.includes('50% T/T BEFORE SHIPMENT') && upperText.includes('50% NET 30')) {
    return PaymentTerms.SPLIT_50_50;
  }
  
  if (upperText.includes('PREPAID')) {
    return PaymentTerms.PREPAID;
  }
  
  if (upperText.includes('COD')) {
    return PaymentTerms.COD;
  }
  
  if (upperText.includes('T/T 30 DAYS AFTER SHIPMENT') || upperText.includes('T/T 30 DAYS AFTER EX-FACTORY')) {
    return PaymentTerms.NET_30;
  }
  
  return PaymentTerms.OTHER;
}

// Detect category from line item text
function detectCategory(fullText: string): InvoiceCategory {
  const upperText = fullText.toUpperCase();
  
  if (upperText.includes('YARN') || upperText.includes('WOOL') || upperText.includes('MERINO')) {
    return InvoiceCategory.YARN;
  }
  
  if (upperText.includes('BAG') || upperText.includes('LABEL') || upperText.includes('TRIM') || 
      upperText.includes('TAG') || upperText.includes('HANGTAG') || upperText.includes('ZIPPER') || 
      upperText.includes('PATCH') || upperText.includes('BADGE') || upperText.includes('STICKER') || 
      upperText.includes('CLIP') || upperText.includes('SEAL') || upperText.includes('BARCODE') || 
      upperText.includes('RIBBON')) {
    return InvoiceCategory.TRIMS;
  }
  
  if (upperText.includes('SAMPLE')) {
    return InvoiceCategory.SAMPLE_CHARGES;
  }
  
  if (upperText.includes('FREIGHT') || upperText.includes('SHIPPING') || upperText.includes('COURIER') || 
      upperText.includes('AIRWAY') || upperText.includes('SURCHARGE')) {
    return InvoiceCategory.SHIPPING_FREIGHT;
  }
  
  if (upperText.includes('DOCUMENTATION')) {
    return InvoiceCategory.SHIPPING_FREIGHT;
  }
  
  if (upperText.includes('LAB TESTING') || upperText.includes('LAB TEST')) {
    return InvoiceCategory.LAB_TESTING;
  }
  
  if (upperText.includes('PROFESSIONAL FEE')) {
    return InvoiceCategory.PROFESSIONAL_FEE;
  }
  
  return InvoiceCategory.OTHER;
}

// Detect order type from invoice text
function detectOrderType(fullText: string): OrderType | undefined {
  const upperText = fullText.toUpperCase();
  
  if (upperText.includes('BULK') || upperText.includes('BULK ORDER')) {
    return OrderType.BULK;
  }
  
  if (upperText.includes('SMS') || upperText.includes('STOCK MAKE SPECIAL')) {
    return OrderType.SMS;
  }
  
  if (upperText.includes('SAMPLE')) {
    return OrderType.SAMPLE;
  }
  
  return undefined;
}

// Detect brand from invoice text
function detectBrand(fullText: string): string | undefined {
  const upperText = fullText.toUpperCase();
  
  // Common brand patterns
  const brandPatterns = [
    /BRAND[:\s]*([A-Z0-9]+)/i,
    /STYLE[:\s]*([A-Z0-9]+)/i,
    /COLLECTION[:\s]*([A-Z0-9]+)/i,
  ];
  
  for (const pattern of brandPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  // Try to extract from line items (e.g., "Superdry", "Nike", etc.)
  const lines = fullText.split('\n');
  for (const line of lines) {
    const upperLine = line.toUpperCase().trim();
    // Skip common non-brand lines
    if (upperLine.length > 3 && upperLine.length < 30 && 
        !upperLine.includes('INVOICE') && 
        !upperLine.includes('DATE') && 
        !upperLine.includes('TOTAL') &&
        !upperLine.includes('AMOUNT') &&
        !upperLine.includes('QUANTITY')) {
      return line.trim();
    }
  }
  
  return undefined;
}

// Detect season from invoice text
function detectSeason(fullText: string): string | undefined {
  const upperText = fullText.toUpperCase();
  
  const seasonPatterns = [
    /(?:SEASON|SS|AW|FW|SPRING|SUMMER|AUTUMN|FALL|WINTER)[\s-]*(\d{4})/i,
    /SS(\d{2})/i,
    /AW(\d{2})/i,
    /FW(\d{2})/i,
    /SPRING\s*(\d{4})/i,
    /SUMMER\s*(\d{4})/i,
    /AUTUMN\s*(\d{4})/i,
    /FALL\s*(\d{4})/i,
    /WINTER\s*(\d{4})/i,
  ];
  
  for (const pattern of seasonPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  
  return undefined;
}

// Detect MPO number from invoice text
function detectMPONumber(fullText: string): string | undefined {
  const mpoPatterns = [
    /MPO[:\s]*([A-Z0-9-]+)/i,
    /M\.P\.O\.[:\s]*([A-Z0-9-]+)/i,
    /MASTER\s*P\.O\.[:\s]*([A-Z0-9-]+)/i,
  ];
  
  for (const pattern of mpoPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

// Detect PO number from invoice text
function detectPONumber(fullText: string): string | undefined {
  const poPatterns = [
    /P\.O\.[:\s]*([A-Z0-9-]+)/i,
    /PO[:\s]*([A-Z0-9-]+)/i,
    /PURCHASE\s*ORDER[:\s]*([A-Z0-9-]+)/i,
    /ORDER\s*NO\.[:\s]*([A-Z0-9-]+)/i,
  ];
  
  for (const pattern of poPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return undefined;
}

// Detect Madison entity from bill-to information
function detectMadisonEntity(billToName: string, billToAddress: string): MadisonEntity | undefined {
  const upperName = billToName.toUpperCase();
  const upperAddress = billToAddress.toUpperCase();
  
  // MADISON_88_LTD
  if (upperName.includes('MADISON 88 LTD') || upperName.includes('MADISON 88, LTD') || 
      upperName.includes('MADISON 88 LIMITED') || upperName.includes('MADISON LIMITED') ||
      upperName.includes('MADISON88, LTD') || upperName.includes('MADISON 88, LTD')) {
    return MadisonEntity.MADISON_88_LTD;
  }
  
  // MADISON_88_NEW_YORK
  if (upperAddress.includes('15 WEST 36TH STREET') || upperAddress.includes('NEW YORK') || 
      upperAddress.includes('NY 10018') || upperAddress.includes('15W 36TH STREET')) {
    return MadisonEntity.MADISON_88_NEW_YORK;
  }
  
  // MADISON_88_HONG_KONG_LIMITED
  if (upperName.includes('MADISON 88 HONG KONG') || upperName.includes('MADISON 88 HONG KONG LIMITED')) {
    return MadisonEntity.MADISON_88_HONG_KONG_LIMITED;
  }
  
  // Buyer code "APH1009 Madison" | "Madison88" (no address) → MADISON_88_LTD (flag MISSING_ADDRESS)
  if (upperName.includes('MADISON88') || upperName.includes('APH1009 MADISON')) {
    return MadisonEntity.MADISON_88_LTD;
  }
  
  return undefined;
}

// Detect urgent payment flag
function detectUrgentPayment(fullText: string): { is_priority: boolean; priority_pay_date?: Date } {
  const upperText = fullText.toUpperCase();
  
  const urgentKeywords = ['URGENT', 'PLEASE PAY ON', 'PLEASE SETTLE', 'NEED PAYMENT', 'NEED PAYMENTS', 
                        'NEED PAYMENTS ON', 'PLEASE PAY ON OR BEFORE', 'NOTE: ADVANCE PAYMENT'];
  
  for (const keyword of urgentKeywords) {
    if (upperText.includes(keyword)) {
      // Try to extract priority pay date
      const dateMatch = fullText.match(/(?:pay on|settle on|before|by)\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i);
      if (dateMatch) {
        return {
          is_priority: true,
          priority_pay_date: parseDate(dateMatch[1])
        };
      }
      
      return { is_priority: true };
    }
  }
  
  return { is_priority: false };
}

// Detect invoice version
function detectInvoiceVersion(invoiceNumber: string, fullText: string): { invoice_version?: string; invoice_version_notes?: string } {
  const upperText = fullText.toUpperCase();
  
  // Check for revision suffix in invoice number
  const revMatch = invoiceNumber.match(/.*?(REV\d+|REV|R\d+|\(\d+\))$/i);
  if (revMatch) {
    return {
      invoice_version: revMatch[1].toUpperCase(),
      invoice_version_notes: 'Revision detected in invoice number'
    };
  }
  
  // Check for revision in full text
  const textRevMatch = upperText.match(/REV(?:ISION)?\s*(\d+)/);
  if (textRevMatch) {
    return {
      invoice_version: `REV${textRevMatch[1]}`,
      invoice_version_notes: 'Revision detected in document'
    };
  }
  
  return {};
}

// Detect payment consolidation note
function detectPaymentConsolidation(fullText: string): string | undefined {
  const upperText = fullText.toUpperCase();
  
  if (upperText.includes('COMBINE PAYMENT') || upperText.includes('SETTLE WITH FUTURE INVOICES')) {
    return 'Payment consolidation requested';
  }
  
  return undefined;
}

// Detect received date stamp
function detectReceivedDate(fullText: string): Date | undefined {
  const receivedPatterns = [
    /INVOICE RECEIVED DATE[:\s]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    /DATE RECEIVED[:\s]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    /RECEIVED[:\s]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
  ];
  
  for (const pattern of receivedPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return parseDate(match[1]);
    }
  }
  
  return undefined;
}

// Detect handwritten document
function detectHandwritten(result: any): boolean {
  // Check confidence scores on major fields
  const fields = result.documents?.[0]?.fields;
  if (!fields) return false;
  
  const majorFields = ['InvoiceId', 'InvoiceTotal', 'VendorName'];
  let lowConfidenceCount = 0;
  
  for (const field of majorFields) {
    const fieldData = fields[field];
    if (fieldData && fieldData.confidence && fieldData.confidence < 0.6) {
      lowConfidenceCount++;
    }
  }
  
  // If more than half of major fields have low confidence, flag as handwritten
  if (lowConfidenceCount >= Math.ceil(majorFields.length / 2)) {
    return true;
  }
  
  // Check if document has no machine-printed structure
  const pages = result.pages;
  if (pages && pages.length > 0) {
    const lines = pages[0].lines;
    if (lines && lines.length < 5) {
      return true;
    }
  }
  
  return false;
}

// Currency conversion rates (simplified - in production, use real-time API)
const EXCHANGE_RATES: Record<string, number> = {
  HKD: 0.128,
  EUR: 1.08,
  GBP: 1.27,
  IDR: 0.000064,
  INR: 0.012,
  VND: 0.00004,
};

function convertToUSD(amount: number, fromCurrency: string): { amount_usd: number; exchange_rate: number } {
  if (fromCurrency === 'USD') {
    return { amount_usd: amount, exchange_rate: 1 };
  }
  
  const rate = EXCHANGE_RATES[fromCurrency.toUpperCase()] || 1;
  return {
    amount_usd: amount * rate,
    exchange_rate: rate
  };
}

export async function analyzeInvoice(fileBuffer: Buffer, mimeType: string): Promise<OCRResult> {
  if (!client) {
    throw new Error('Azure Form Recognizer client not configured');
  }

  try {
    const poller = await client.beginAnalyzeDocument(
      'prebuilt-invoice',
      fileBuffer
    );

    const result = await poller.pollUntilDone();

    if (!result.documents || result.documents.length === 0) {
      throw new Error('No invoice document found in analysis result');
    }

    const document = result.documents[0];
    const fields = document.fields;

    // Extract basic fields from Form Recognizer
    let invoice_number = fields?.InvoiceId?.content || '';
    // Strip * * delimiters and spaces
    invoice_number = invoice_number.replace(/\*/g, '').replace(/\s+/g, '');
    
    const invoice_date = fields?.InvoiceDate?.content ? parseDate(fields.InvoiceDate.content) : new Date();
    const due_date = fields?.DueDate?.content ? parseDate(fields.DueDate.content) : undefined;
    const vendor_name = fields?.VendorName?.content || '';
    let amount = fields?.InvoiceTotal?.content ? parseFloat(fields.InvoiceTotal.content) : 0;
    const currency = fields?.CurrencyCode?.content || 'USD';
    const bill_to_name = fields?.CustomerName?.content || '';
    const bill_to_address = fields?.BillingAddress?.content || '';

    // Extract full text for custom parsing
    const fullText = result.pages?.map(page => 
      page.lines?.map(line => line.content).join('\n') || ''
    ).join('\n') || '';

    // Detect handwritten document
    const is_handwritten = detectHandwritten(result);

    // Custom field extraction
    const invoice_type = detectInvoiceType(fullText);
    const category = detectCategory(fullText);
    const order_type = detectOrderType(fullText);
    const brand = detectBrand(fullText);
    const season = detectSeason(fullText);
    const mpo_number = detectMPONumber(fullText);
    const po_number = detectPONumber(fullText);
    const payment_terms = detectPaymentTerms(fullText);
    const incoterm_match = fullText.match(/\b(EXW|DAP|FOB|CIF|DDP|CFR)\b/i);
    const incoterm = incoterm_match ? incoterm_match[1].toUpperCase() : undefined;
    const bill_to_entity = detectMadisonEntity(bill_to_name, bill_to_address);
    const { is_priority, priority_pay_date } = detectUrgentPayment(fullText);
    const { invoice_version, invoice_version_notes } = detectInvoiceVersion(invoice_number, fullText);
    const payment_consolidation_note = detectPaymentConsolidation(fullText);
    const invoice_received_date = detectReceivedDate(fullText);

    // Currency conversion for non-USD invoices
    let amount_original: number | undefined;
    let currency_original: string | undefined;
    let exchange_rate_to_usd: number | undefined;
    
    if (currency !== 'USD') {
      amount_original = amount;
      currency_original = currency;
      const conversion = convertToUSD(amount, currency);
      amount = conversion.amount_usd;
      exchange_rate_to_usd = conversion.exchange_rate;
    }

    // Extract bank information from remittance section
    const bank_info = extractBankInfo(fields, fullText);

    // Extract signatures
    const signatures = extractSignatures(fields, fullText);

    // Extract charges
    const bank_charges = extractCharge(fullText, 'bank charge');
    const shipping_charges = extractCharge(fullText, 'shipping') || extractCharge(fullText, 'freight');
    const customs_charges = extractCharge(fullText, 'customs');
    const documentation_charges = extractCharge(fullText, 'documentation');
    const surcharges = extractCharge(fullText, 'surcharge');

    return {
      invoice_number,
      invoice_date,
      due_date,
      invoice_received_date,
      invoice_version,
      invoice_version_notes,
      vendor_name,
      amount,
      amount_original,
      currency_original,
      exchange_rate_to_usd,
      currency,
      payment_terms,
      incoterm,
      bank_charges,
      shipping_charges,
      customs_charges,
      documentation_charges,
      surcharges,
      invoice_type,
      category,
      order_type,
      brand,
      season,
      mpo_number,
      po_number,
      bill_to_name,
      bill_to_address,
      bill_to_entity,
      is_handwritten,
      is_priority,
      priority_pay_date,
      payment_consolidation_note,
      bank_info,
      signatures,
      raw_data: result,
    };
  } catch (error) {
    console.error('Error analyzing invoice:', error);
    throw new Error(`Failed to analyze invoice: ${error}`);
  }
}

function extractCharge(fullText: string, chargeType: string): number {
  const pattern = new RegExp(`${chargeType}[:\\s]*([\\d,]+\\.?\\d*)`, 'i');
  const match = fullText.match(pattern);
  if (match) {
    return parseFloat(match[1].replace(/,/g, ''));
  }
  return 0;
}

function extractBankInfo(fields: any, fullText: string): BankInfo {
  const bankInfo: BankInfo = {};

  // Try to extract from Form Recognizer fields
  if (fields?.RemittanceAddress) {
    const remittanceText = fields.RemittanceAddress.content || '';
    bankInfo.bank_address = remittanceText;
  }

  // Custom parsing from full text for bank details
  const lines = fullText.split('\n');
  
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    
    // Extract SWIFT code with normalization
    const swiftMatch = upperLine.match(/SWIFT[:\s]*([A-Z]{6}[A-Z0-9]{0,5})/i);
    if (swiftMatch) {
      bankInfo.swift_code = normalizeSwiftCode(swiftMatch[1]);
    }

    // Extract bank name
    if (upperLine.includes('BANK') && !bankInfo.bank_name) {
      bankInfo.bank_name = line.trim();
    }

    // Extract IBAN
    const ibanMatch = line.match(/IBAN[:\s]*([A-Z]{2}\d{2}[A-Z0-9]+)/i);
    if (ibanMatch) {
      bankInfo.iban = ibanMatch[1];
    }

    // Extract sort code
    const sortCodeMatch = line.match(/SORT CODE[:\s]*(\d{2}-?\d{2}-?\d{2})/i);
    if (sortCodeMatch) {
      bankInfo.sort_code = sortCodeMatch[1];
    }

    // Extract ABA routing number
    const abaMatch = line.match(/ABA[:\s]*(\d{9})/i);
    if (abaMatch) {
      bankInfo.aba_routing_number = abaMatch[1];
    }

    // Extract account numbers
    const accountMatch = line.match(/ACCOUNT[:\s]*(\d+)/i);
    if (accountMatch) {
      const accountNum = accountMatch[1];
      if (line.toUpperCase().includes('USD')) {
        bankInfo.account_usd = accountNum;
      } else if (line.toUpperCase().includes('HKD')) {
        bankInfo.account_hkd = accountNum;
      } else if (line.toUpperCase().includes('EUR')) {
        bankInfo.account_eur = accountNum;
      } else if (line.toUpperCase().includes('IDR')) {
        bankInfo.account_idr = accountNum;
      } else if (line.toUpperCase().includes('INR')) {
        bankInfo.account_inr = accountNum;
      } else if (line.toUpperCase().includes('VND')) {
        bankInfo.account_vnd = accountNum;
      } else if (!bankInfo.account_usd) {
        bankInfo.account_usd = accountNum;
      }
    }

    // Extract intermediary bank
    if (upperLine.includes('INTERMEDIARY') || upperLine.includes('CORRESPONDENT')) {
      const interSwiftMatch = line.match(/SWIFT[:\s]*([A-Z]{6}[A-Z0-9]{0,5})/i);
      if (interSwiftMatch) {
        bankInfo.intermediary_bank_swift = normalizeSwiftCode(interSwiftMatch[1]);
      }
      const interNameMatch = line.match(/(?:INTERMEDIARY|CORRESPONDENT)\s*(?:BANK)?[:\s]*(.+?)(?:SWIFT|$)/i);
      if (interNameMatch) {
        bankInfo.intermediary_bank_name = interNameMatch[1].trim();
      }
    }
  }

  return bankInfo;
}

function extractSignatures(fields: any, fullText: string): SignatureInfo[] {
  const signatures: SignatureInfo[] = [];
  
  // Form Recognizer may detect signatures
  if (fields?.Signatures) {
    // This would need to be implemented based on actual Form Recognizer output
    // For now, return empty array
  }

  // Custom parsing for signature blocks
  const lines = fullText.split('\n');
  let currentSignature: Partial<SignatureInfo> = {};
  
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    
    // Detect signature block patterns
    if (upperLine.includes('SIGNED BY') || upperLine.includes('APPROVED BY') || upperLine.includes('AUTHORIZED BY')) {
      if (currentSignature.signer_name) {
        signatures.push(currentSignature as SignatureInfo);
      }
      currentSignature = {};
    }

    // Extract signer name
    if (upperLine.includes('NAME') || upperLine.match(/^[A-Z\s]+$/)) {
      if (!currentSignature.signer_name && line.trim().length > 2) {
        currentSignature.signer_name = line.trim();
      }
    }

    // Extract date
    const dateMatch = line.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    if (dateMatch) {
      currentSignature.signed_at = parseDate(dateMatch[1]);
    }

    // Extract role
    if (upperLine.includes('COORDINATOR')) {
      currentSignature.role = 'COORDINATOR';
    } else if (upperLine.includes('MANAGER')) {
      currentSignature.role = 'MANAGER';
    } else if (upperLine.includes('PLANNING')) {
      currentSignature.role = 'PLANNING_MANAGER';
    } else if (upperLine.includes('LINDSEY')) {
      currentSignature.role = 'LINDSEY';
    }

    // Detect digital signatures
    if (upperLine.includes('DIGITAL') || upperLine.includes('ELECTRONIC')) {
      currentSignature.is_digital = true;
    }
  }

  if (currentSignature.signer_name) {
    if (!currentSignature.is_digital) {
      currentSignature.is_digital = false;
    }
    signatures.push(currentSignature as SignatureInfo);
  }

  return signatures;
}
