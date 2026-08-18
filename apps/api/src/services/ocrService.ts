import PDFParser from 'pdf2json';
import { InvoiceType, InvoiceCategory, PaymentTerms, BillToEntity, OrderType, SignatoryRole, SignatureType } from '@ap-invoice/shared';
import { parsePOReference, matchSignerToRole, TOP_10_BRANDS, isTop10Brand } from '@ap-invoice/shared';
import { logger } from '../utils/logger';
import { convertPDFToImages } from '../utils/pdfToImages';
import { mergeEngineResults, EngineResult } from './engineConsensus';
import { doclingService } from './doclingService';
import { extractTextWithOpenDataLoader } from './openDataLoaderService';
import { rapidOCRService } from './rapidOCRService';
import { upstageOCRService } from './upstageOCRService';

export interface BankInfo {
  beneficiary_name?: string;
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

// Sanitize values from Upstage that may return comma-separated multi-doc values (e.g. "2026-06-23, 2026-06-17")
function sanitizeSingleValue(val: string | undefined | null): string | undefined {
  if (!val || typeof val !== 'string') return val || undefined;
  const trimmed = val.trim();
  if (trimmed.includes(',')) {
    return trimmed.split(',')[0].trim();
  }
  return trimmed || undefined;
}

// Map AI-returned document_type strings to valid InvoiceType enum values
const DOCUMENT_TYPE_MAP: Record<string, string> = {
  INVOICE: 'INVOICE',
  COMMERCIAL_INVOICE: 'COMMERCIAL',
  COMMERCIAL: 'COMMERCIAL',
  PROFORMA: 'PROFORMA',
  PRO_FORMA: 'PROFORMA',
  SALES: 'SALES',
  SALES_INVOICE: 'SALES',
  STATEMENT: 'STATEMENT',
  DEBIT_NOTE: 'INVOICE',
  CREDIT_NOTE: 'INVOICE',
  PREPAID: 'PREPAID',
  PROTO_SAMPLE: 'PROTO_SAMPLE',
};

function mapDocumentType(docType: string | undefined): string {
  if (!docType) return 'INVOICE';
  const normalized = docType.toUpperCase().trim();
  return DOCUMENT_TYPE_MAP[normalized] || 'INVOICE';
}

export interface SignatureInfo {
  signatory_name: string;
  signed_at?: Date;
  signatory_role: SignatoryRole;
  signature_type: SignatureType;
  ocr_detected?: boolean;
}

export interface OCRResult {
  invoice_number: string;
  invoice_date: Date;
  due_date?: Date;
  invoice_received_date?: Date;
  date_range_start?: Date;
  date_range_end?: Date;
  vendor_name: string;
  total_amount: number;
  subtotal?: number;
  currency: string;
  invoice_currency_original?: string;
  exchange_rate_to_usd?: number;
  payment_terms: PaymentTerms;
  incoterm?: string;
  bank_charges: number;
  freight_charges: number;
  additional_charges: number;
  invoice_type: InvoiceType;
  invoice_template_type?: string;
  category: InvoiceCategory;
  order_type?: OrderType;
  brand?: string;
  brand_code?: string;
  season?: string;
  mpo_number?: string;
  customer_po_number?: string;
  bill_to_entity?: BillToEntity;
  is_handwritten: boolean;
  is_urgent: boolean;
  priority_pay_date?: Date;
  ocr_confidence_score?: number;
  qb_memo?: string;
  qb_account_class?: string;
  bank_info: BankInfo;
  signatures: SignatureInfo[];
  raw_data: any;
}

async function extractTextFromPDF(fileBuffer: Buffer): Promise<string> {
  // Try OpenDataLoader first — ranked #1 in extraction benchmarks
  try {
    const text = await extractTextWithOpenDataLoader(fileBuffer);
    if (text && text.length > 20) {
      logger.info(`[OCR] OpenDataLoader extraction succeeded — ${text.length} chars`);
      return text;
    }
  } catch (e) {
    logger.warn('[OCR] OpenDataLoader extraction failed, falling back to pdf2json:', e instanceof Error ? e.message : String(e));
  }

  // Fallback: pdf2json
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser as any)(null, 1);
    
    const safeDecode = (str: string): string => {
      try { return decodeURIComponent(str); } catch { return str; }
    };
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        const text = pdfData.Pages
          .map((page: any) => 
            page.Texts
              .map((t: any) => safeDecode(t.R[0].T))
              .join(' ')
          )
          .join('\n');
        console.log('[OCR] Text extracted, length:', text.length);
        console.log('[OCR] First 300 chars:', text.substring(0, 300));
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });

    pdfParser.on('pdfParser_dataError', (err: any) => {
      console.error('[OCR] PDF parse error:', err);
      reject(err);
    });

    pdfParser.parseBuffer(fileBuffer);
  });
}

export async function extractInvoiceFields(fileBuffer: Buffer) {
  const text = await extractTextFromPDF(fileBuffer);
  return extractInvoiceFieldsFromText(text, fileBuffer);
}

async function extractInvoiceFieldsFromText(text: string, fileBuffer?: Buffer) {
  console.log('[OCR] Extracted text length:', text.length);
  console.log('[OCR] Text contains 8.62:', text.includes('8.62'));
  console.log('[OCR] Text contains TOTAL USD:', text.toUpperCase().includes('TOTAL USD'));
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // vendor_name — multiple patterns for different invoice formats
  const vendorNamePatterns = [
    /^(Avery Dennison Hong Kong B\.V\.)/m,
    /^(Avery Dennison[^\n]+)/m,
    /^(PT\.?\s*[A-Z\s]+INDONESIA)/m, // PT. PAXAR INDONESIA style
    /^([A-Z][A-Za-z\s]+(?:Ltd|Limited|Co\.|Corp|Inc|B\.V\.|LLC|HK|Pte|SDN|BHD)\.?)/m,
    /^([A-Z][A-Za-z\s&]+(?:Corporation|Company|Inc|LLC|Ltd|Sdn|Bhd))/m,
    /^([A-Z][A-Za-z\s&]+)/m, // Generic: any capitalized company name
  ];

  // Known BILL TO entities that should not be extracted as vendors
  const billToEntities = ['MADISON LIMITED', 'MADISON 88 LTD', 'MADISON_88_LTD'];

  let vendor_name = '';
  for (const pattern of vendorNamePatterns) {
    const m = text.match(pattern);
    if (m) {
      const candidate = m[1] ? m[1].trim() : m[0].trim();
      // Skip if this is a known BILL TO entity
      if (!billToEntities.some(entity => candidate.toUpperCase().includes(entity))) {
        vendor_name = candidate;
        // Limit to reasonable length (avoid extracting entire page)
        if (vendor_name.length > 100) {
          vendor_name = vendor_name.substring(0, 100);
        }
        break;
      }
    }
  }
  
  // Fallback to known vendor list (expanded)
  if (!vendor_name) {
    const knownVendors = [
      'Avery Dennison', 'PT Paxar', 'PT. PAXAR INDONESIA', 'Trimco', 'Jointak',
      'Brand ID', 'Checkpoint', 'Rudholm', 'Nilorn', 'R-PAC',
      'Charming', 'Ducksan', 'Master Air', 'SF Express', 'Weavabel',
      'G&F Trading', 'Perfect China', 'YKK', 'Coats', 'Avery'
    ];
    const foundVendor = knownVendors.find(v =>
      text.toLowerCase().includes(v.toLowerCase())
    );
    vendor_name = foundVendor || lines[0];
  }

  // invoice_number — multiple patterns, prioritized by specificity
  // Must contain at least one digit to avoid matching words like "signature"
  const invoiceNumberPatterns = [
    /INVOICE\s*NO[:\s#]*([A-Z0-9\-\/*]+)/i,
    /INVOICE\s*NO[.]*[:\s#]*([A-Z0-9\-\/*]+)/i,
    /INVOICE\s*NUMBER[:\s#]*([A-Z0-9\-\/*]+)/i,
    /INV(?:OICE)?\s*#[:\s]*([A-Z0-9\-\/*]+)/i,
    /Invoice\s*#[:\s]*([A-Z0-9\-\/*]+)/i,
    /I\/V\s*NO[.]*[:\s]*([A-Z0-9\-\/*]+)/i,
    /PI\s*No[.]*[:\s]*([A-Z0-9\-\/*]+)/i,
    /PI#[:\s]*([A-Z0-9\-\/*]+)/i,
    /P\/I\s*NO[:\s]*([A-Z0-9\-\/*]+)/i,
    /SI\s*No[:\s]*([A-Z0-9\-\/*]+)/i,
    /D\/N\s*No[.]*[:\s]*([A-Z0-9\-\/*]+)/i,
    /Bill\s*No[:\s]*([A-Z0-9\-\/*]+)/i,
    /Bill\s*Number[:\s]*([A-Z0-9\-\/*]+)/i,
    /Order\s*#[:\s]*([A-Z0-9\-\/*]+)/i,
    /BILL\s*TO[:\s\.:]*[\s\n]*([A-Z]{2,4}[-\s]*\d{4,10})/i, // Invoice number after BILL TO (e.g., PCI-26018341)
    /Ref[:\s#]*([A-Z0-9\-\/*]+)/i,
    /Reference[:\s#]*([A-Z0-9\-\/*]+)/i,
  ];
  
  let invoice_number = '';
  
  // First, try to find invoice number in the header section (first 30% of text)
  const headerSection = text.substring(0, Math.floor(text.length * 0.3));
  for (const pattern of invoiceNumberPatterns) {
    const m = headerSection.match(pattern);
    if (m) { 
      // Validate: must contain at least one digit
      if (/\d/.test(m[1])) {
        invoice_number = m[1]; 
        break;
      }
    }
  }
  
  // If not found in header, search full text but exclude signature section
  if (!invoice_number) {
    // Remove signature section (text after "Signature", "Signed by", "Authorized", etc.)
    const signatureKeywords = ['Signature', 'Signed by', 'Authorized', 'Signatory', 'Approved by', 'For'];
    let textWithoutSignature = text;
    for (const keyword of signatureKeywords) {
      const index = textWithoutSignature.indexOf(keyword);
      if (index !== -1) {
        textWithoutSignature = textWithoutSignature.substring(0, index);
      }
    }
    
    for (const pattern of invoiceNumberPatterns) {
      const m = textWithoutSignature.match(pattern);
      if (m) { 
        // Validate: must contain at least one digit
        if (/\d/.test(m[1])) {
          invoice_number = m[1]; 
          break;
        }
      }
    }
  }

  // invoice_date — multiple date formats
  const datePatterns = [
    /INVOICE\s*DATE[:\s]*(\d{2}-[A-Z]{3}-\d{4})/i,
    /INVOICE\s*DATE[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /INVOICE\s*DATE[:\s]*(\d{4}-\d{2}-\d{2})/i,
    /INVOICE\s*DATE[:\s]*(\d{4}\.\d{2}\.\d{2})/i,
    /INVOICE\s*DATE[:\s]*(\d{2}\.\d{2}\.\d{4})/i,
    /INVOICE\s*DATE[:\s]*([A-Z][a-z]+\s+\d{1,2},?\s*\d{2,4})/i, // Month DD,YY
    /Date[:\s]*(\d{2}-[A-Z]{3}-\d{4})/i,
    /Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Date[:\s]*(\d{4}-\d{2}-\d{2})/i,
    /Issued\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Billing\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(\d{6})\b/, // YYMMDD format (260114 → 2026-01-14)
    /(\d{2}-[A-Z]{3}-\d{4})/, // Fallback: find any DD-MMM-YYYY
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/, // Fallback: find any DD/MM/YYYY
  ];
  let invoice_date = '';
  for (const pattern of datePatterns) {
    const m = text.match(pattern);
    if (m) { invoice_date = m[1]; break; }
  }

  // due_date — multiple patterns
  const dueDatePatterns = [
    /DUE\s*DATE[:\s]*(\d{2}-[A-Z]{3}-\d{4})/i,
    /DUE\s*DATE[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /DUE\s*DATE[:\s]*(\d{4}-\d{2}-\d{2})/i,
    /INVOICE\s*DUE\s*DATE[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /INVOICE\s*DUE[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /PAYMENT\s*DUE\s*DATE[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Due\s*by[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Payment\s*Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Pay\s*Before[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Settle[:\s]*(?:on|before)?[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  let due_date = '';
  for (const pattern of dueDatePatterns) {
    const m = text.match(pattern);
    if (m) { due_date = m[1]; break; }
  }

  // amount — multiple patterns for different layouts and brands
  const amountPatterns = [
    /TOTAL\s*\(USD\)\s*([\d,]+\.\d{2,4})/i,
    /TOTAL\s*USD\s*([\d,]+\.\d{2,4})/i,
    /TOTAL\s*USD[\s\S]{0,150}([\d,]+\.\d{2,4})/i, // TOTAL USD followed by amount within 150 chars (handles different cells)
    /TOTAL\s*USD/i, // Match TOTAL USD, then find amount nearby
    /TOTAL\s*(?:AMOUNT)?[:\s]*([\d,]+\.\d{2,4})/i,
    /Grand\s*Total[:\s]*([\d,]+\.\d{2,4})/i,
    /GrandTotal[:\s]*([\d,]+\.\d{2,4})/i,
    /Net\s*Amount[:\s]*([\d,]+\.\d{2,4})/i,
    /Net\s*Total[:\s]*([\d,]+\.\d{2,4})/i,
    /Amount[:\s]*([\d,]+\.\d{2,4})/i,
    /Balance\s*Due[:\s]*([\d,]+\.\d{2,4})/i,
    /Subtotal[:\s]*([\d,]+\.\d{2,4})/i,
    /Total[:\s]*([\d,]+\.\d{2,4})/i,
    /USD\s*([\d,]+\.\d{2,4})/i, // Just USD followed by amount
    /([\d,]+\.\d{2,4})\s*USD/i, // Amount followed by USD
  ];

  const grandTotalPatterns = [
    /Grand\s*Total\s*(?:USD|HKD|EUR|GBP|PHP|JPY|IDR)?\s*[:\s]*([\d,]+\.\d{2,4})/i,
    /GrandTotal\s*[:\s]*([\d,]+\.\d{2,4})/i,
    /Grand\s*Total\s*[:\s]*([\d,]+\.\d{2,4})/i,
  ];

  let amount = 0;
  let grand_total = 0;

  // Prose-based currency extraction (e.g., "settle in USD 96.68")
  const prosePatterns = [
    /settle\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2,4})/i,
    /payment\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2,4})/i,
    /for\s+settlement\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)[^0-9]*([\d,]+\.\d{2,4})/i,
    /please\s+settle\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2,4})/i,
  ];

  // Try standard patterns first
  for (const pattern of amountPatterns) {
    const m = text.match(pattern);
    if (m) {
      if (m[1]) {
        const extractedAmount = parseFloat(m[1].replace(/,/g, ''));
        if (extractedAmount > 0) {
          amount = extractedAmount;
          logger.info(`[OCR] Amount extracted from pattern: ${amount}`);
          break;
        }
      }
    }
  }

  // Extract explicit Grand Total separately
  for (const pattern of grandTotalPatterns) {
    const m = text.match(pattern);
    if (m && m[1]) {
      const extractedGrandTotal = parseFloat(m[1].replace(/,/g, ''));
      if (extractedGrandTotal > 0) {
        grand_total = extractedGrandTotal;
        logger.info(`[OCR] Grand Total extracted from pattern: ${grand_total}`);
        break;
      }
    }
  }

  // Fallback to prose-based patterns if standard patterns don't match
  if (amount === 0) {
    for (const pattern of prosePatterns) {
      const m = text.match(pattern);
      if (m) { amount = parseFloat(m[1].replace(/,/g, '')); break; }
    }
  }

  // Direct search: Look for TOTAL USD and find the nearest amount
  if (amount === 0) {
    const totalUsdMatch = text.match(/TOTAL\s*USD/i);
    logger.info(`[OCR] TOTAL USD match: ${totalUsdMatch ? 'YES' : 'NO'}`);
    if (totalUsdMatch) {
      const totalUsdIndex = text.toUpperCase().indexOf('TOTAL USD');
      logger.info(`[OCR] TOTAL USD index: ${totalUsdIndex}`);
      // Search in a wider range (500 chars) to handle different cell layouts
      const searchRange = text.substring(totalUsdIndex, totalUsdIndex + 500);
      logger.info(`[OCR] Search range: ${searchRange.substring(0, 100)}`);
      const amountMatch = searchRange.match(/([\d,]+\.\d{2,4})/);
      logger.info(`[OCR] Amount match in range: ${amountMatch ? amountMatch[1] : 'NONE'}`);
      if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        logger.info(`[OCR] Amount from TOTAL USD search: ${amount}`);
      }
    }
  }

  // FIX: Better fallback using weighted scoring by label proximity
  // Don't use last decimal - could be tax, discount, or vendor balance
  if (amount === 0) {
    const allAmounts = text.match(/[\d,]+\.\d{2,4}/g);
    logger.info(`[OCR] All decimal amounts found: ${JSON.stringify(allAmounts)}`);
    
    if (allAmounts && allAmounts.length > 0) {
      const amountCandidates: Array<{ value: number; score: number }> = [];

      for (const match of allAmounts) {
        const index = text.indexOf(match);
        const before = text.substring(Math.max(0, index - 100), index);
        const numValue = parseFloat(match.replace(/,/g, ''));

        // Calculate confidence score based on surrounding text
        let score = 0;
        if (/TOTAL|GRAND|FINAL/i.test(before)) score += 100;
        if (/AMOUNT|INVOICE|BILL|NET/i.test(before)) score += 80;
        if (/SUBTOTAL|BALANCE|DUE/i.test(before)) score += 60;
        if (/TAX|DISCOUNT|FREIGHT|BANK|VENDOR|BALANCE|COMMISSION/i.test(before))
          score -= 80;
        if (/DEPOSIT|ADVANCE|RETENTION|REFUND/i.test(before)) score -= 50;

        // Penalize very small amounts (likely not invoice total)
        if (numValue < 1) score -= 100;
        // Penalize very large amounts (likely not single invoice)
        if (numValue > 1000000) score -= 50;

        amountCandidates.push({ value: numValue, score });
      }

      // Sort by score and pick the best
      if (amountCandidates.length > 0) {
        const best = amountCandidates.sort((a, b) => b.score - a.score)[0];
        if (best.score >= 0) {
          amount = best.value;
          logger.info(`[OCR] Amount extracted using weighted scoring: ${amount} (score: ${best.score})`);
        } else {
          // If all scores are negative, use the largest amount
          const largest = amountCandidates.sort((a, b) => b.value - a.value)[0];
          amount = largest.value;
          logger.info(`[OCR] Amount extracted as largest value: ${amount}`);
        }
      }
    }
  }

  const currencyMatch = text.match(/\b(USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\b/);

  // mpo_number — multiple patterns
  const mpoPatterns = [
    /MPO\s*(\d{3,4})\s*(\d{2,4})/i,
    /MPO(\d{5,8})/i,
    /MPO\s*#?\s*(\d{5,8})/i,
  ];
  let mpo_number = '';
  for (const pattern of mpoPatterns) {
    const m = text.match(pattern);
    if (m) {
      if (m[2]) {
        mpo_number = m[1] + m[2]; // Handle split MPO numbers
      } else {
        mpo_number = m[1];
      }
      // Normalize: MPO + 6-digit zero-padded (MPO15569 → MPO015569)
      mpo_number = 'MPO' + mpo_number.replace(/^MPO/i, '').replace(/^0+/, '').padStart(6, '0');
      break;
    }
  }

  // po_reference — multiple patterns for different brands
  const poPatterns = [
    /Sold To\s*:\s*(\d+)\s*\/\s*[A-Z\s]+/i,
    /PO\s*#[:\s]*([A-Z0-9\-\/_]+)/i,
    /P\.O\.\s*#[:\s]*([A-Z0-9\-\/_]+)/i,
    /Customer\s*PO[:\s]*([A-Z0-9\-\/_]+)/i,
    /PO\s*Reference[:\s]*([A-Z0-9\-\/_]+)/i,
    /P\/O\s*#[:\s]*([A-Z0-9\-\/_]+)/i,
    /PO\s*No[:\s]*([A-Z0-9\-\/_]+)/i,
    /Purchase\s*Order[:\s]*([A-Z0-9\-\/_]+)/i,
  ];
  let po_reference = '';
  for (const pattern of poPatterns) {
    const m = text.match(pattern);
    if (m) { po_reference = m[1]; break; }
  }

  // brand_code — only extract from PO reference format, not from random text
  // Pattern: BRAND_SEASON_ORDER_TYPE (e.g., TNF_F26_BULK, CSC_FH26_SMS)
  // This will be parsed from po_reference later in analyzeInvoice
  let brand_code = '';

  // swift code — multiple patterns
  const swiftPatterns = [
    /Swift\s*code\s*:\s*([A-Z]{6}[A-Z0-9]{2,5})/i,
    /SWIFT[:\s]*([A-Z]{6}[A-Z0-9]{2,5})/i,
    /\b([A-Z]{6}[A-Z0-9]{2,5})\b.*Bank/i,
  ];
  let bank_swift = '';
  for (const pattern of swiftPatterns) {
    const m = text.match(pattern);
    if (m) { bank_swift = m[1]; break; }
  }

  // bank account — multiple patterns
  const accountPatterns = [
    /A\/C#\s*([\d\-]+)\s*\(USD\)/i,
    /A\/C\s*No[.]*[:\s]*([\d\-]+)/i,
    /Our\s*A\/C\s*No[.]*[:\s]*([\d\-]+)/i,
    /Account\s*#[:\s]*([\d\-]+)/i,
    /Account\s*No[:\s]*([\d\-]+)/i,
    /Account\s*Number[:\s]*([\d\-]+)/i,
    /Beneficiary\s*Account[:\s]*([\d\-]+)/i,
  ];
  let bank_account = '';
  for (const pattern of accountPatterns) {
    const m = text.match(pattern);
    if (m) { bank_account = m[1]; break; }
  }

  // payment_terms — multiple patterns
  const paymentPatterns = [
    /TERMS[:\s]*(Net\s*Due\s*in\s*\d+\s*Days|NET\s*\d+|PBS|COD|prepaid|TT|LC|DA|DP)/i,
    /Payment\s*Terms[:\s]*(Net\s*\d+|PBS|COD|TT|LC|DA|DP)/i,
    /Net\s*\d+/i,
    /Payment\s*Terms[:\s]*([A-Za-z\s]+)/i,
    /Terms[:\s]*([A-Za-z\s]+)/i,
  ];
  let payment_terms = '';
  for (const pattern of paymentPatterns) {
    const m = text.match(pattern);
    if (m) { payment_terms = m[0]; break; }
  }

  // tax/vat/gst — multiple patterns
  const taxPatterns = [
    /VAT\s*[:#]*([A-Z0-9]+)/i,
    /Tax\s*ID[:\s]*([A-Z0-9]+)/i,
    /GST\s*[:#]*([A-Z0-9]+)/i,
    /Tax\s*No[:\s]*([A-Z0-9]+)/i,
  ];
  let tax_id = '';
  for (const pattern of taxPatterns) {
    const m = text.match(pattern);
    if (m) { tax_id = m[1]; break; }
  }

  // company registration number
  const regPatterns = [
    /Reg\s*No[:\s]*([A-Z0-9]+)/i,
    /Registration\s*No[:\s]*([A-Z0-9]+)/i,
    /Co\s*Reg[:\s]*([A-Z0-9]+)/i,
  ];
  let company_reg = '';
  for (const pattern of regPatterns) {
    const m = text.match(pattern);
    if (m) { company_reg = m[1]; break; }
  }

  let invoiceType = 'INVOICE';
  if (/proforma|pro-forma|pro\s*forma/i.test(text)) invoiceType = 'PROFORMA';
  else if (/commercial\s*invoice/i.test(text)) invoiceType = 'COMMERCIAL';
  else if (/sales\s*invoice/i.test(text)) invoiceType = 'SALES';
  else if (/debit\s*note/i.test(text)) invoiceType = 'DEBIT_NOTE';
  else if (/credit\s*note/i.test(text)) invoiceType = 'CREDIT_NOTE';
  else if (/account\s*statement|statement|aging|aged\s*balance/i.test(text)) invoiceType = 'STATEMENT';

  // incoterm — multiple patterns
  const incotermPatterns = [
    /\b(EXW|DAP|FOB|CIF|DDP|CFR|FCA|CPT|CIP)\b/i,
    /Incoterm[:\s]*([A-Z]{3})/i,
    /Trade\s*Terms[:\s]*([A-Z]{3})/i,
  ];
  let incoterm = '';
  for (const pattern of incotermPatterns) {
    const m = text.match(pattern);
    if (m) { incoterm = m[1].toUpperCase(); break; }
  }

  // exchange_rate — prose-based patterns (e.g., "settle in USD @7.70")
  const exchangeRatePatterns = [
    /@\s*([\d]+\.\d+)/i, // @7.70
    /Exchange\s*Rate[:\s]*([\d]+\.\d+)/i,
    /FX\s*Rate[:\s]*([\d]+\.\d+)/i,
    /Rate[:\s]*([\d]+\.\d{3,})/i, // Rate: 7.70 (require 3+ decimals to avoid matching amounts)
  ];
  let exchange_rate: number | undefined;
  for (const pattern of exchangeRatePatterns) {
    const m = text.match(pattern);
    if (m) { exchange_rate = parseFloat(m[1]); break; }
  }

  // is_handwritten — low text density detection
  const is_handwritten = text.length < 200;

  // is_statement — statement/aging detection
  const is_statement = /account\s*statement|aging|aged\s*balance|outstanding\s*balance|current\s*charges/i.test(text);

  const result = {
    vendor_name: vendor_name,
    invoice_number: invoice_number,
    invoice_date: invoice_date,
    due_date: due_date,
    amount: amount,
    grand_total: grand_total,
    currency: currencyMatch?.[1] || 'USD',
    po_reference: po_reference,
    mpo_number: mpo_number,
    brand_code: brand_code,
    payment_terms: payment_terms,
    bank_swift: bank_swift,
    bank_account: bank_account,
    invoice_type: invoiceType,
    tax_id: tax_id,
    company_reg: company_reg,
    incoterm: incoterm || undefined,
    exchange_rate: exchange_rate,
    is_handwritten: is_handwritten || undefined,
    is_statement: is_statement || undefined,
  };

  console.log('[DEBUG] Extracted fields:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Try AI fallback OCR engines with per-field consensus voting.
 *
 * First, the strongest engines run IN PARALLEL and their results are merged by
 * per-field majority voting (engineConsensus.ts):
 *   - Groq (Llama 3.3 70B — fast ~2s, accurate, text mode)
 *   - OpenRouter (free-tier vision LLM, e.g. qwen2.5-vl-72b — reads page images,
 *     so it also works on scanned PDFs where text extraction yields nothing)
 *   - Regex over the extracted text (deterministic third opinion)
 *
 * The consensus wait is bounded by OPENROUTER_CONSENSUS_WAIT_MS so stragglers
 * never block the pipeline — engines that don't finish just don't vote.
 *
 * If consensus produces nothing usable, the sequential safety net runs:
 * Upstage (single-step PDF extraction) → Ollama (local, unlimited) → Gemini Vision → Mistral.
 * Returns the merged result with engine name, or null if all engines fail.
 */
async function tryAIFallbacks(
  fileBuffer: Buffer,
  rawText: string,
  vendorName?: string
): Promise<{ engine: string; vendor_name?: string; invoice_number?: string; invoice_date?: string; due_date?: string; total_amount?: number; subtotal?: number; currency?: string; po_number?: string; mpo_number?: string; brand?: string; brand_code?: string; season?: string; payment_terms?: string; ship_to?: string; sold_to?: string; qty_shipped?: number; document_type?: string; bank_name?: string; swift_code?: string; account_number?: string; bank_info?: { swift_code?: string; account_number?: string }; line_items?: any[]; signatures?: { signatory_name: string; signatory_role?: string; signed_date?: string }[]; bank_charges?: number; tt_charge?: number; freight_charges?: number; courier_charges?: number; handling_fee?: number; finance_surcharge?: number; tax_amount?: number; discount_amount?: number; setup_charge?: number; sample_charge?: number; min_order_charge?: number; additional_charges?: number } | null> {
  // ─── CONSENSUS PATH: strongest engines in parallel + per-field majority vote ───
  const consensusResults: EngineResult[] = [];
  const consensusWaitMs = Number(process.env.OPENROUTER_CONSENSUS_WAIT_MS) || 45000;

  const withTimeout = async (label: string, task: () => Promise<void>): Promise<void> => {
    try {
      await Promise.race([
        task(),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${consensusWaitMs}ms`)), consensusWaitMs)),
      ]);
    } catch (e) {
      logger.warn(`[OCR] Consensus engine ${label} skipped:`, e instanceof Error ? e.message : String(e));
    }
  };

  const tasks: Promise<void>[] = [];

  // Engine 1: Groq (fast text extraction)
  if (rawText && rawText.length > 50) {
    tasks.push(withTimeout('groq', async () => {
      const groqOCR = (await import('./groqOCRService')).groqOCRService;
      if (groqOCR.isAvailable()) {
        logger.info('[OCR] Consensus engine: Groq (text)...');
        const groqResult = await groqOCR.extractFromText(rawText, { vendorName } as any);
        if (groqResult && (groqResult.vendor_name || groqResult.invoice_number)) {
          consensusResults.push({ engine: 'groq', data: groqResult as any });
        }
      }
    }));
  }

  // Engine 2: OpenRouter free vision (reads page images — works on scans too)
  const openrouterConfigured = (await import('./openrouterOCRService')).openrouterOCRService.isAvailable();
  if (openrouterConfigured) {
    const imagePages = convertPDFToImages(fileBuffer);
    tasks.push(withTimeout('openrouter', async () => {
      const openrouterOCR = (await import('./openrouterOCRService')).openrouterOCRService;
      let openrouterResult: any = null;
      if (imagePages.length > 0) {
        logger.info(`[OCR] Consensus engine: OpenRouter vision (${imagePages.length} page images)...`);
        openrouterResult = await openrouterOCR.extractFromImages(imagePages, { vendorName } as any);
      }
      if (!openrouterResult && rawText && rawText.length > 50) {
        logger.info('[OCR] Consensus engine: OpenRouter text...');
        openrouterResult = await openrouterOCR.extractFromText(rawText, { vendorName } as any);
      }
      if (openrouterResult && (openrouterResult.vendor_name || openrouterResult.invoice_number)) {
        consensusResults.push({ engine: 'openrouter', data: openrouterResult });
      }
    }));
  }

  // Engine 3: deterministic regex over the extracted text
  if (rawText && rawText.length > 50) {
    tasks.push(withTimeout('regex', async () => {
      const regexResult = await extractInvoiceFieldsFromText(rawText, fileBuffer);
      if (regexResult && (regexResult.vendor_name || regexResult.invoice_number)) {
        consensusResults.push({
          engine: 'regex',
          data: {
            vendor_name: regexResult.vendor_name,
            invoice_number: regexResult.invoice_number,
            invoice_date: regexResult.invoice_date,
            due_date: regexResult.due_date,
            total_amount: regexResult.amount,
            currency: regexResult.currency,
            po_number: regexResult.po_reference,
            mpo_number: regexResult.mpo_number,
            brand_code: regexResult.brand_code,
            payment_terms: regexResult.payment_terms,
            document_type: regexResult.invoice_type,
            swift_code: regexResult.bank_swift,
            account_number: regexResult.bank_account,
            incoterm: regexResult.incoterm,
            exchange_rate: regexResult.exchange_rate,
          },
        });
      }
    }));
  }

  await Promise.all(tasks);

  if (consensusResults.length > 0) {
    const merged = mergeEngineResults(consensusResults);
    const hasCore = merged.data.invoice_number || merged.data.vendor_name || merged.data.total_amount;
    if (hasCore) {
      logger.info(`[OCR] Consensus result: base_engine=${merged.base_engine}, engines=[${merged.engines_used.join(', ')}], vendor="${merged.data.vendor_name}", invoice#="${merged.data.invoice_number}", amount=${merged.data.total_amount}`);
      return {
        engine: 'consensus',
        ...merged.data,
        consensus_engines: merged.engines_used,
        consensus_details: merged.per_field,
      } as any;
    }
  }

  logger.warn('[OCR] Consensus produced no usable result — falling back to sequential engines');

  // 2nd priority: Upstage Info Extraction (single-step PDF → fields, 300 PPM, ~10-12s)
  // Directly extracts structured fields from PDF — no separate OCR step needed
  try {
    if (upstageOCRService.isAvailable()) {
      logger.info('[OCR] Trying Upstage Info Extraction — 2nd priority (single-step PDF extraction)...');
      const upstageResult = await upstageOCRService.extractFromPDF(fileBuffer);
      if (upstageResult && (upstageResult.vendor_name || upstageResult.invoice_number)) {
        logger.info('[OCR] Upstage Info Extraction succeeded');
        // Convert string values to numbers where needed
        const converted: any = { ...upstageResult };
        if (converted.total_amount) converted.total_amount = Number(converted.total_amount) || undefined;
        if (converted.subtotal) converted.subtotal = Number(converted.subtotal) || undefined;
        if (converted.qty_shipped) converted.qty_shipped = Number(converted.qty_shipped) || undefined;
        if (converted.bank_charges) converted.bank_charges = Number(converted.bank_charges) || undefined;
        if (converted.tt_charge) converted.tt_charge = Number(converted.tt_charge) || undefined;
        if (converted.freight_charges) converted.freight_charges = Number(converted.freight_charges) || undefined;
        if (converted.courier_charges) converted.courier_charges = Number(converted.courier_charges) || undefined;
        if (converted.handling_fee) converted.handling_fee = Number(converted.handling_fee) || undefined;
        if (converted.finance_surcharge) converted.finance_surcharge = Number(converted.finance_surcharge) || undefined;
        if (converted.tax_amount) converted.tax_amount = Number(converted.tax_amount) || undefined;
        if (converted.discount_amount) converted.discount_amount = Number(converted.discount_amount) || undefined;
        if (converted.setup_charge) converted.setup_charge = Number(converted.setup_charge) || undefined;
        if (converted.sample_charge) converted.sample_charge = Number(converted.sample_charge) || undefined;
        if (converted.min_order_charge) converted.min_order_charge = Number(converted.min_order_charge) || undefined;
        if (converted.additional_charges) converted.additional_charges = Number(converted.additional_charges) || undefined;
        if (converted.exchange_rate) converted.exchange_rate = Number(converted.exchange_rate) || undefined;
        // Convert line items
        if (converted.line_items) {
          converted.line_items = converted.line_items.map((li: any) => ({
            ...li,
            quantity: Number(li.quantity) || 0,
            unit_price: Number(li.unit_price) || 0,
            total_amount: Number(li.total_amount) || 0,
          }));
        }
        return { engine: 'upstage', ...converted };
      }
    }
  } catch (e) {
    logger.error('[OCR] Upstage Info Extraction failed:', e);
  }

  // 3rd priority: Ollama (Qwen2.5 — local, no rate limits, ~73-88s on CPU)
  // Used when Groq/Upstage rate limits are hit
  if (rawText && rawText.length > 50) {
    try {
      const ollamaOCR = (await import('./ollamaOCRService')).ollamaOCRService;
      if (ollamaOCR.isAvailable()) {
        logger.info('[OCR] Trying Ollama (Qwen2.5) — 3rd priority (local, no rate limits)...');
        const ollamaResult = await ollamaOCR.extractFromText(rawText, { vendorName });
        if (ollamaResult && (ollamaResult.vendor_name || ollamaResult.invoice_number)) {
          logger.info('[OCR] Ollama (Qwen2.5) extraction succeeded');
          return { engine: 'ollama', ...ollamaResult };
        }
      }
    } catch (e) {
      logger.error('[OCR] Ollama (Qwen2.5) extraction failed:', e);
    }
  } else {
    logger.warn('[OCR] No raw text — trying PDF-to-image conversion for Ollama vision...');
    const imagesBase64 = convertPDFToImages(fileBuffer);
    if (imagesBase64.length > 0) {
      for (let i = 0; i < imagesBase64.length; i++) {
        try {
          const ollamaOCR = (await import('./ollamaOCRService')).ollamaOCRService;
          if (ollamaOCR.isAvailable()) {
            logger.info(`[OCR] Trying Ollama (Qwen) vision fallback with PDF image (page ${i + 1}/${imagesBase64.length})...`);
            const ollamaResult = await ollamaOCR.extractFromImage(imagesBase64[i], { vendorName });
            if (ollamaResult && (ollamaResult.vendor_name || ollamaResult.invoice_number)) {
              logger.info('[OCR] Ollama (Qwen) vision fallback succeeded');
              return { engine: 'ollama-vision', ...ollamaResult };
            }
          }
        } catch (e) {
          logger.error(`[OCR] Ollama vision fallback failed for page ${i + 1}:`, e);
        }
      }
    }
  }

  // 4th fallback: Gemini Vision (sends PDF as file directly — best for scanned PDFs)
  try {
    const geminiOCR = (await import('./geminiOCRService')).geminiOCRService;
    if (geminiOCR.isAvailable()) {
      logger.info('[OCR] Trying Gemini Vision fallback (4th priority)...');
      const geminiResult = await geminiOCR.extractFromPDF(fileBuffer, vendorName);
      if (geminiResult && (geminiResult.vendor_name || geminiResult.invoice_number)) {
        logger.info('[OCR] Gemini Vision fallback succeeded');
        return { engine: 'gemini', ...geminiResult };
      }
    }
  } catch (e) {
    logger.error('[OCR] Gemini Vision fallback failed:', e);
  }

  // 5th fallback: Mistral (text-based, decent free-tier)
  if (rawText && rawText.length > 50) {
    try {
      const mistralOCR = (await import('./mistralOCRService')).mistralOCRService;
      if (mistralOCR.isAvailable()) {
        logger.info('[OCR] Trying Mistral fallback with raw text...');
        const mistralResult = await mistralOCR.extractFromText(rawText, { vendorName } as any);
        if (mistralResult && (mistralResult.vendor_name || mistralResult.invoice_number)) {
          logger.info('[OCR] Mistral fallback succeeded');
          return { engine: 'mistral', ...mistralResult };
        }
      }
    } catch (e) {
      logger.error('[OCR] Mistral fallback failed:', e);
    }
  }

  return null;
}

// ─── REAL CONFIDENCE CALCULATION ───────────────────────────────────────────
// Known garbage values that pdf2json or AI might extract incorrectly
const GARBAGE_VENDOR_NAMES = [
  'account no', 'invoice', 'invoice invoice', 'invoice invoice no',
  'tax invoice', 'bill to', 'ship to', 'sold to', 'total', 'amount',
  'description', 'quantity', 'unit price', 'no.', 'date',
];
const GARBAGE_INVOICE_NUMBERS = [
  'invoice', 'invoice no', 'invoice number', 'no', 'no.', 'number',
  'account no', 'tax invoice',
];

function isGarbageValue(value: string | undefined, garbageList: string[]): boolean {
  if (!value || !value.trim()) return true;
  const lower = value.trim().toLowerCase();
  if (garbageList.some(g => lower === g || lower === g + ' no')) return true;
  // Too short or just generic words
  if (lower.length < 2) return true;
  // Repeated words like "INVOICE INVOICE"
  const words = lower.split(/\s+/);
  if (words.length >= 2 && words.every(w => w === words[0])) return true;
  return false;
}

function isValidAmount(amount: number | undefined): boolean {
  if (!amount || isNaN(amount) || amount <= 0) return false;
  if (amount > 10000000) return false; // >$10M is suspicious
  return true;
}

function isValidDate(dateStr: string | undefined): boolean {
  if (!dateStr || !dateStr.trim()) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const year = d.getFullYear();
  return year >= 2010 && year <= 2030;
}

/**
 * Calculate realistic OCR confidence based on actual field quality.
 * Returns a value between 0 and 1.
 *
 * Scoring breakdown (100 points total, scaled to 0-1):
 * - vendor_name: 20 pts (only if not garbage)
 * - invoice_number: 15 pts (only if not garbage)
 * - total_amount: 20 pts (only if valid positive number)
 * - invoice_date: 10 pts (only if valid date)
 * - po_number/mpo_number: 15 pts
 * - currency: 5 pts
 * - line_items: 5 pts
 * - bank_info: 5 pts (swift/account)
 * - signatures: 5 pts
 *
 * Penalties:
 * - Garbage vendor name: -15 pts
 * - Garbage invoice number: -10 pts
 * - Missing line items when amount > 0: -5 pts
 */
function calculateRealConfidence(
  extracted: any,
  usedAIFallback: boolean,
  ocrEngine: string
): number {
  let score = 0;

  // vendor_name (20 pts)
  if (extracted.vendor_name && !isGarbageValue(extracted.vendor_name, GARBAGE_VENDOR_NAMES)) {
    score += 20;
  } else if (extracted.vendor_name && isGarbageValue(extracted.vendor_name, GARBAGE_VENDOR_NAMES)) {
    score -= 15; // Penalty for garbage
  }

  // invoice_number (15 pts)
  if (extracted.invoice_number && !isGarbageValue(extracted.invoice_number, GARBAGE_INVOICE_NUMBERS)) {
    score += 15;
  } else if (extracted.invoice_number && isGarbageValue(extracted.invoice_number, GARBAGE_INVOICE_NUMBERS)) {
    score -= 10;
  }

  // total_amount (20 pts)
  const amount = extracted.amount || extracted.total_amount;
  if (isValidAmount(Number(amount))) {
    score += 20;
  }

  // invoice_date (10 pts)
  if (isValidDate(extracted.invoice_date)) {
    score += 10;
  }

  // po_number or mpo_number (15 pts)
  if ((extracted.po_reference || extracted.po_number || extracted.mpo_number) &&
      !isGarbageValue(extracted.po_reference || extracted.po_number, [])) {
    score += 15;
  }

  // currency (5 pts)
  if (extracted.currency && extracted.currency.trim().length === 3) {
    score += 5;
  }

  // line_items (5 pts)
  const lineItems = (extracted as any).line_items;
  if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
    score += 5;
  } else if (isValidAmount(Number(amount)) && !lineItems) {
    // Penalty: has amount but no line items
    score -= 5;
  }

  // bank_info (5 pts)
  if ((extracted as any).bank_swift || (extracted as any).bank_account ||
      (extracted as any).bank_name || (extracted as any).bank_info) {
    score += 5;
  }

  // signatures (5 pts)
  if ((extracted as any).signatures && Array.isArray((extracted as any).signatures) &&
      (extracted as any).signatures.length > 0) {
    score += 5;
  }

  // AI fallback gets a small bonus (better at understanding layout) but not a free pass
  if (usedAIFallback) {
    score += 5;
  }

  // Clamp to 0-100 then scale to 0-1
  score = Math.max(0, Math.min(100, score));
  const confidence = score / 100;

  logger.info(
    `[OCR] Confidence: ${(confidence * 100).toFixed(0)}% (engine: ${ocrEngine}, ` +
    `vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}", ` +
    `amount: ${amount}, date: ${extracted.invoice_date})`
  );

  return confidence;
}

// ─── DOCLING FALLBACK (problem invoices) ───────────────────────────────────
/**
 * A "problem invoice" is one where the primary pipeline missed a critical field
 * (invoice number, vendor, or amount). Those are exactly the invoices that end up
 * with placeholder numbers (SFTP-<ts>) or fail validation. For those, we run
 * Docling (clean label:value Markdown, ~80s, local CPU) and re-extract from it.
 */
export function shouldRunDoclingFallback(extracted: any): boolean {
  if (!extracted) return true;
  const hasInvoiceNumber = !!(extracted.invoice_number && String(extracted.invoice_number).trim());
  const hasVendor = !!(extracted.vendor_name && String(extracted.vendor_name).trim());
  const hasAmount = isValidAmount(Number(extracted.amount));
  return !hasInvoiceNumber || !hasVendor || !hasAmount;
}

function countCriticalFields(extracted: any): number {
  let count = 0;
  if (extracted?.invoice_number && String(extracted.invoice_number).trim()) count++;
  if (extracted?.vendor_name && String(extracted.vendor_name).trim()) count++;
  if (isValidAmount(Number(extracted?.amount))) count++;
  return count;
}

/** Map the internal `extracted` shape onto the canonical engine-consensus keys. */
function mapExtractedToEngineShape(extracted: any): Record<string, any> {
  return {
    vendor_name: extracted.vendor_name,
    invoice_number: extracted.invoice_number,
    invoice_date: extracted.invoice_date,
    due_date: extracted.due_date,
    total_amount: extracted.amount,
    currency: extracted.currency,
    po_number: extracted.po_reference,
    mpo_number: extracted.mpo_number,
    brand: extracted.brand,
    brand_code: extracted.brand_code,
    season: extracted.season,
    payment_terms: extracted.payment_terms,
    document_type: extracted.invoice_type,
    swift_code: extracted.bank_swift,
    account_number: extracted.bank_account,
    beneficiary_name: extracted.beneficiary_name,
    bank_name: extracted.bank_name,
    qty_shipped: extracted.qty_shipped,
    ship_to: extracted.ship_to,
    sold_to: extracted.sold_to,
    line_items: extracted.line_items,
    signatures: extracted.signatures,
    subtotal: extracted.subtotal,
    bank_charges: extracted.bank_charges,
    tt_charge: extracted.tt_charge,
    freight_charges: extracted.freight_charges,
    courier_charges: extracted.courier_charges,
    handling_fee: extracted.handling_fee,
    finance_surcharge: extracted.finance_surcharge,
    tax_amount: extracted.tax_amount,
    discount_amount: extracted.discount_amount,
    setup_charge: extracted.setup_charge,
    sample_charge: extracted.sample_charge,
    min_order_charge: extracted.min_order_charge,
    additional_charges: extracted.additional_charges,
    incoterm: extracted.incoterm,
    exchange_rate: extracted.exchange_rate,
    is_handwritten: extracted.is_handwritten,
    is_statement: extracted.is_statement,
  };
}

/** Map merged consensus data back onto the internal `extracted` shape. */
function mapEngineShapeToExtracted(mergedData: any, primary: any): any {
  const d = mergedData || {};
  const out: any = {
    vendor_name: d.vendor_name || primary.vendor_name || '',
    invoice_number: d.invoice_number || primary.invoice_number || '',
    invoice_date: d.invoice_date ? new Date(d.invoice_date).toISOString().split('T')[0] : (primary.invoice_date || ''),
    due_date: d.due_date ? new Date(d.due_date).toISOString().split('T')[0] : (primary.due_date || ''),
    amount: d.total_amount || primary.amount || 0,
    grand_total: 0,
    currency: d.currency || primary.currency || 'USD',
    po_reference: d.po_number || primary.po_reference || '',
    mpo_number: d.mpo_number || primary.mpo_number || '',
    brand_code: d.brand_code || primary.brand_code || '',
    payment_terms: d.payment_terms || primary.payment_terms || '',
    bank_swift: d.swift_code || primary.bank_swift || '',
    bank_account: d.account_number || primary.bank_account || '',
    beneficiary_name: d.beneficiary_name || primary.beneficiary_name || '',
    invoice_type: d.document_type ? mapDocumentType(d.document_type) : (primary.invoice_type || 'INVOICE'),
    tax_id: '',
    company_reg: '',
    incoterm: d.incoterm || primary.incoterm,
    exchange_rate: d.exchange_rate ?? primary.exchange_rate,
    is_handwritten: d.is_handwritten ?? primary.is_handwritten,
    is_statement: d.is_statement ?? primary.is_statement,
  };
  // Carry extended fields (whichever side provided them).
  for (const key of ['qty_shipped', 'bank_name', 'ship_to', 'sold_to', 'brand', 'season', 'line_items', 'signatures', 'subtotal', 'bank_charges', 'tt_charge', 'freight_charges', 'courier_charges', 'handling_fee', 'finance_surcharge', 'tax_amount', 'discount_amount', 'setup_charge', 'sample_charge', 'min_order_charge', 'additional_charges']) {
    if (d[key] !== undefined) out[key] = d[key];
    else if (primary[key] !== undefined) out[key] = primary[key];
  }
  return out;
}

/**
 * Run Docling on the PDF, re-extract from its clean Markdown with the available
 * engines (Groq / OpenRouter / regex), and merge with the primary result via
 * per-field majority voting. Returns the improved extraction if it fills a
 * critical field gap, otherwise the original.
 */
async function tryDoclingFallback(fileBuffer: Buffer, extracted: any): Promise<{ improved: boolean; extracted: any }> {
  if (!doclingService.isAvailable()) {
    return { improved: false, extracted };
  }

  let markdown: string;
  try {
    logger.info('[OCR] Docling fallback: extracting clean Markdown (this takes ~80s)...');
    markdown = await doclingService.extractMarkdown(fileBuffer);
  } catch (e) {
    logger.warn(`[OCR] Docling fallback skipped: ${e instanceof Error ? e.message : String(e)}`);
    return { improved: false, extracted };
  }

  try {
    const results: EngineResult[] = [{ engine: 'primary', data: mapExtractedToEngineShape(extracted) }];

    if (markdown && markdown.length > 50) {
      // LLM engines on the clean label:value markdown
      const groqOCR = (await import('./groqOCRService')).groqOCRService;
      if (groqOCR.isAvailable()) {
        const r = await groqOCR.extractFromText(markdown, { vendorName: extracted.vendor_name } as any);
        if (r && (r.vendor_name || r.invoice_number)) results.push({ engine: 'docling-groq', data: r as any });
      }
      const openrouterOCR = (await import('./openrouterOCRService')).openrouterOCRService;
      if (openrouterOCR.isAvailable()) {
        const r = await openrouterOCR.extractFromText(markdown, { vendorName: extracted.vendor_name } as any);
        if (r && (r.vendor_name || r.invoice_number)) results.push({ engine: 'docling-openrouter', data: r as any });
      }
      // Deterministic regex third opinion on the clean markdown
      try {
        const regexResult = await extractInvoiceFieldsFromText(markdown, fileBuffer);
        if (regexResult && (regexResult.vendor_name || regexResult.invoice_number || regexResult.amount)) {
          results.push({
            engine: 'docling-regex',
            data: {
              vendor_name: regexResult.vendor_name,
              invoice_number: regexResult.invoice_number,
              invoice_date: regexResult.invoice_date,
              due_date: regexResult.due_date,
              total_amount: regexResult.amount,
              currency: regexResult.currency,
              po_number: regexResult.po_reference,
              mpo_number: regexResult.mpo_number,
              payment_terms: regexResult.payment_terms,
              document_type: regexResult.invoice_type,
            },
          });
        }
      } catch (regexErr) {
        logger.warn('[OCR] Docling regex opinion failed:', regexErr);
      }
    }

    const merged = mergeEngineResults(results);
    const fallbackExtracted = mapEngineShapeToExtracted(merged.data, extracted);
    const improved = countCriticalFields(fallbackExtracted) > countCriticalFields(extracted);

    if (improved) {
      logger.info(`[OCR] Docling fallback improved extraction — invoice#: "${fallbackExtracted.invoice_number}", vendor: "${fallbackExtracted.vendor_name}", amount: ${fallbackExtracted.amount} (engines: ${merged.engines_used.join(', ')})`);
    }
    return { improved, extracted: fallbackExtracted };
  } catch (e) {
    logger.warn(`[OCR] Docling fallback merge failed: ${e instanceof Error ? e.message : String(e)}`);
    return { improved: false, extracted };
  }
}

export async function analyzeInvoice(fileBuffer: Buffer, mimeType: string) {
  let extracted: any;
  let usedGeminiVision = false;
  let usedAIFallback = false;
  let ocrEngine = 'rapidocr';
  let rapidOcrConfidence = 0;

  // ─── RAPIDOCR-FIRST APPROACH ───
  // 1. Try RapidOCR (fast, 5-9s, 97% confidence, free, local)
  let rapidOcrText = '';
  try {
    const rapidOcrResult = await rapidOCRService.extractText(fileBuffer);
    if (rapidOcrResult && rapidOcrResult.text && rapidOcrResult.text.length > 20) {
      rapidOcrText = rapidOcrResult.text;
      rapidOcrConfidence = rapidOcrResult.confidence;
      logger.info(`[OCR] RapidOCR extraction succeeded — ${rapidOcrText.length} chars, confidence: ${(rapidOcrConfidence * 100).toFixed(1)}%, ${rapidOcrResult.elapsed_ms}ms`);
    }
  } catch (e) {
    logger.warn('[OCR] RapidOCR extraction failed:', e instanceof Error ? e.message : String(e));
  }

  // 2. Confidence-based routing
  // RapidOCR confidence reflects character recognition accuracy (97-98%),
  // NOT field extraction quality. RapidOCR text lacks spaces between words,
  // so regex patterns fail. Always use AI for field extraction.
  // RapidOCR replaces OpenDataLoader as the text extractor (better quality text).
  const CONFIDENCE_THRESHOLD = 1.01; // Always use AI fallback

  if (rapidOcrText && rapidOcrConfidence >= CONFIDENCE_THRESHOLD) {
    // High confidence — use regex extraction on RapidOCR text
    logger.info(`[OCR] RapidOCR confidence ${(rapidOcrConfidence * 100).toFixed(1)}% ≥ ${CONFIDENCE_THRESHOLD * 100}% — using regex extraction (fast path)`);
    try {
      extracted = await extractInvoiceFieldsFromText(rapidOcrText, fileBuffer);
      ocrEngine = 'rapidocr-regex';
    } catch (regexErr) {
      logger.warn('[OCR] Regex extraction on RapidOCR text failed, falling back to AI:', regexErr);
      extracted = null;
    }
  }

  if (!extracted) {
    // Low confidence or RapidOCR unavailable — try AI fallback
    // Use RapidOCR text if available, otherwise fall back to OpenDataLoader
    let rawText = rapidOcrText;
    if (!rawText) {
      logger.info('[OCR] RapidOCR unavailable — falling back to OpenDataLoader for text extraction');
      try {
        rawText = await extractTextFromPDF(fileBuffer);
      } catch {
        // pdf2json text extraction failed — Gemini Vision can still read the PDF directly
      }
    }

    if (rapidOcrText && rapidOcrConfidence < CONFIDENCE_THRESHOLD) {
      logger.info(`[OCR] RapidOCR confidence ${(rapidOcrConfidence * 100).toFixed(1)}% < ${CONFIDENCE_THRESHOLD * 100}% — using AI fallback for better accuracy`);
    } else if (!rapidOcrText) {
      logger.info('[OCR] AI-first mode: attempting AI extraction with OpenDataLoader text');
    }

    // AI fallback: Groq (fast, accurate, truncated for token limits) → Ollama (slow, unlimited) → Gemini
    const aiResult = await tryAIFallbacks(fileBuffer, rawText, undefined);

    if (aiResult && (aiResult.vendor_name || aiResult.invoice_number)) {
      usedAIFallback = true;
      ocrEngine = aiResult.engine;
      if (aiResult.engine === 'gemini') {
        usedGeminiVision = true;
      }

      extracted = {
        vendor_name: sanitizeSingleValue(aiResult.vendor_name) || '',
        invoice_number: sanitizeSingleValue(aiResult.invoice_number) || '',
        invoice_date: aiResult.invoice_date ? new Date(sanitizeSingleValue(aiResult.invoice_date) || '').toISOString().split('T')[0] : '',
        due_date: aiResult.due_date ? new Date(sanitizeSingleValue(aiResult.due_date) || '').toISOString().split('T')[0] : '',
        amount: aiResult.total_amount || 0,
        grand_total: 0,
        currency: aiResult.currency || 'USD',
        po_reference: aiResult.po_number || '',
        mpo_number: aiResult.mpo_number ? 'MPO' + aiResult.mpo_number.replace(/^MPO/i, '').replace(/^0+/, '').padStart(6, '0') : '',
        brand_code: aiResult.brand_code || '',
        payment_terms: aiResult.payment_terms || '',
        bank_swift: aiResult.swift_code || aiResult.bank_info?.swift_code || '',
        bank_account: aiResult.account_number || (aiResult.bank_info as any)?.account_usd || aiResult.bank_info?.account_number || '',
        beneficiary_name: (aiResult as any).beneficiary_name || (aiResult as any).bank_info?.beneficiary_name || '',
        invoice_type: mapDocumentType(sanitizeSingleValue((aiResult as any).document_type)) as any,
        tax_id: '',
        company_reg: '',
        incoterm: (aiResult as any).incoterm || undefined,
        exchange_rate: (aiResult as any).exchange_rate,
        is_handwritten: (aiResult as any).is_handwritten === true || (aiResult as any).is_handwritten === 'true' || undefined,
        is_statement: (aiResult as any).is_statement === true || (aiResult as any).is_statement === 'true' || undefined,
      };
      // Store extra AI-extracted fields
      (extracted as any).qty_shipped = aiResult.qty_shipped;
      (extracted as any).bank_name = aiResult.bank_name;
      (extracted as any).ship_to = aiResult.ship_to;
      (extracted as any).sold_to = aiResult.sold_to;
      (extracted as any).brand = aiResult.brand;
      (extracted as any).season = aiResult.season;
      (extracted as any).line_items = aiResult.line_items;
      (extracted as any).signatures = aiResult.signatures;
      (extracted as any).subtotal = aiResult.subtotal;
      (extracted as any).bank_charges = aiResult.bank_charges;
      (extracted as any).tt_charge = aiResult.tt_charge;
      (extracted as any).freight_charges = aiResult.freight_charges;
      (extracted as any).courier_charges = aiResult.courier_charges;
      (extracted as any).handling_fee = aiResult.handling_fee;
      (extracted as any).finance_surcharge = aiResult.finance_surcharge;
      (extracted as any).tax_amount = aiResult.tax_amount;
      (extracted as any).discount_amount = aiResult.discount_amount;
      (extracted as any).setup_charge = aiResult.setup_charge;
      (extracted as any).sample_charge = aiResult.sample_charge;
      (extracted as any).min_order_charge = aiResult.min_order_charge;
      (extracted as any).additional_charges = aiResult.additional_charges;

      logger.info(`[OCR] AI extraction succeeded with ${ocrEngine} — vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}", amount: ${extracted.amount}`);

      // Vision-based bank info fallback
      const hasBankInfo = (extracted as any).bank_name || extracted.bank_swift || extracted.bank_account;
      if (!hasBankInfo) {
        logger.info('[OCR] Bank info missing from text extraction — trying vision-based extraction for bank details...');
        try {
          const geminiOCR = (await import('./geminiOCRService')).geminiOCRService;
          if (geminiOCR.isAvailable()) {
            const bankResult = await geminiOCR.extractFromPDF(fileBuffer, extracted.vendor_name);
            if (bankResult && (bankResult.bank_name || bankResult.swift_code || bankResult.account_number)) {
              logger.info(`[OCR] Vision bank fallback succeeded — bank_name: "${bankResult.bank_name}", swift: "${bankResult.swift_code}", account: "${bankResult.account_number}"`);
              (extracted as any).bank_name = bankResult.bank_name || (extracted as any).bank_name;
              extracted.bank_swift = bankResult.swift_code || extracted.bank_swift;
              extracted.bank_account = bankResult.account_number || extracted.bank_account;
            }
          }
        } catch (visionErr) {
          logger.warn('[OCR] Vision-based bank info fallback failed:', visionErr instanceof Error ? visionErr.message : String(visionErr));
        }
      }

      // Cross-validate with regex if we have RapidOCR text
      if (rapidOcrText && rapidOcrText.length > 50) {
        try {
          const regexResult = await extractInvoiceFieldsFromText(rapidOcrText, fileBuffer);
          if (regexResult) {
            if (regexResult.amount && extracted.amount &&
                Math.abs(regexResult.amount - extracted.amount) > 0.01 &&
                regexResult.amount > 0) {
              const diff = Math.abs(regexResult.amount - extracted.amount) / Math.max(regexResult.amount, extracted.amount);
              if (diff > 0.05) {
                logger.warn(`[OCR] Amount mismatch: AI=${extracted.amount}, regex=${regexResult.amount} (diff: ${(diff * 100).toFixed(1)}%) — using AI value`);
              }
            }
            if ((!extracted.invoice_number || extracted.invoice_number.trim() === '') && regexResult.invoice_number) {
              logger.info(`[OCR] AI missed invoice_number, regex found: "${regexResult.invoice_number}" — using regex value`);
              extracted.invoice_number = regexResult.invoice_number;
            }
            if ((!extracted.vendor_name || extracted.vendor_name.trim() === '') && regexResult.vendor_name) {
              logger.info(`[OCR] AI missed vendor_name, regex found: "${regexResult.vendor_name}" — using regex value`);
              extracted.vendor_name = regexResult.vendor_name;
            }
            if ((!extracted.invoice_date || extracted.invoice_date === '') && regexResult.invoice_date) {
              logger.info(`[OCR] AI missed invoice_date, regex found: "${regexResult.invoice_date}" — using regex value`);
              extracted.invoice_date = regexResult.invoice_date;
            }
          }
        } catch (regexErr) {
          logger.warn('[OCR] Regex cross-validation skipped:', regexErr);
        }
      }
    } else {
      // AI failed — fall back to regex on whatever text we have
      logger.warn('[OCR] AI extraction failed — falling back to regex');
      ocrEngine = rapidOcrText ? 'rapidocr-regex' : 'pdf2json';
      try {
        if (rapidOcrText) {
          extracted = await extractInvoiceFieldsFromText(rapidOcrText, fileBuffer);
        } else {
          extracted = await extractInvoiceFields(fileBuffer);
        }
      } catch (pdfError) {
        console.error('[OCR] All extraction methods failed:', pdfError);
        logger.error('[OCR] All extraction methods failed');
        throw pdfError;
      }
    }
  }

  // ─── DOCLING FALLBACK: problem invoices (missing critical fields) ───
  // Docling produces clean label:value Markdown that the LLM/regex engines can
  // parse reliably — the recovery path for the SFTP-<ts> placeholder class of bugs.
  if (doclingService.isAvailable() && shouldRunDoclingFallback(extracted)) {
    const fallback = await tryDoclingFallback(fileBuffer, extracted);
    if (fallback.improved) {
      extracted = fallback.extracted;
      ocrEngine = 'docling-fallback';
      usedAIFallback = true;
      logger.info(`[OCR] Docling fallback result adopted — invoice#: "${extracted.invoice_number}", vendor: "${extracted.vendor_name}", amount: ${extracted.amount}`);
    } else {
      logger.info('[OCR] Docling fallback did not improve extraction — keeping primary result');
    }
  }

  logger.info(`[OCR] Final extraction — engine: ${ocrEngine}, vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}", amount: ${extracted.amount}`);

  const poParsed = extracted.po_reference ? parsePOReference(extracted.po_reference) : {};

  // Calculate real confidence based on field quality, not hardcoded values
  const calculatedConfidence = calculateRealConfidence(extracted, usedAIFallback, ocrEngine);

  return {
    invoice_number: extracted.invoice_number || '',
    invoice_date: extracted.invoice_date ? new Date(extracted.invoice_date) : new Date(),
    due_date: extracted.due_date ? new Date(extracted.due_date) : undefined,
    invoice_received_date: new Date(),
    vendor_name: extracted.vendor_name || '',
    total_amount: extracted.amount || 0,
    grand_total: extracted.grand_total || undefined,
    subtotal: (extracted as any).subtotal || undefined,
    currency: extracted.currency || 'USD',
    invoice_currency_original: extracted.currency || 'USD',
    exchange_rate_to_usd: undefined,
    date_range_start: undefined,
    date_range_end: undefined,
    payment_terms: extracted.payment_terms || PaymentTerms.NET_30,
    incoterm: undefined,
    bank_charges: (extracted as any).bank_charges || 0,
    freight_charges: (extracted as any).freight_charges || 0,
    additional_charges: (extracted as any).additional_charges || 0,
    invoice_type: ((extracted as any).is_statement && extracted.invoice_type !== 'STATEMENT')
      ? InvoiceType.STATEMENT as any
      : (extracted.invoice_type as InvoiceType || InvoiceType.INVOICE),
    category: inferServiceInvoiceCategory(extracted),
    order_type: poParsed.order_type as OrderType | undefined,
    brand: poParsed.brand_code ? (TOP_10_BRANDS[poParsed.brand_code] || poParsed.brand_code) : (extracted as any).brand || undefined,
    brand_code: poParsed.brand_code || extracted.brand_code || undefined,
    season: poParsed.season || (extracted as any).season || undefined,
    mpo_number: (() => {
      // Prefer AI's direct MPO extraction, fall back to parsePOReference
      const raw = extracted.mpo_number || poParsed.mpo_number || '';
      if (!raw) return raw as any;
      const digits = raw.replace(/^MPO/i, '').replace(/^0+/, '');
      return 'MPO' + digits.padStart(6, '0');
    })(),
    customer_po_number: (() => {
      // Prefer parsePOReference, then the AI's direct PO extraction/reference.
      const raw = poParsed.po_number || (extracted as any).po_number || (extracted as any).po_reference || '';
      if (!raw) return raw as any;
      const poMatch = raw.match(/\bPO(\d{4,6})\b/i);
      if (poMatch) return 'PO' + poMatch[1].padStart(6, '0');
      return raw;
    })(),
    bill_to_entity: BillToEntity.MADISON_88_LTD,
    is_handwritten: (extracted as any).is_handwritten || false,
    is_urgent: false,
    priority_pay_date: undefined,
    ocr_confidence_score: calculatedConfidence,
    qb_memo: undefined,
    qb_account_class: undefined,
    bank_info: {
      beneficiary_name: (extracted as any).beneficiary_name || (extracted as any).bank_info?.beneficiary_name || undefined,
      bank_name: (extracted as any).bank_name || undefined,
      swift_code: extracted.bank_swift,
      account_usd: extracted.bank_account,
    } as BankInfo,
    signatures: ((extracted as any).signatures || [])
      .filter((sig: any) => sig && (sig.signatory_name || sig.signatory_role))
      .map((sig: any) => {
      const role = matchSignerToRole(sig.signatory_name) ||
        (sig.signatory_role && Object.values(SignatoryRole).includes(sig.signatory_role.toUpperCase().replace(/ /g, '_') as any)
          ? (sig.signatory_role.toUpperCase().replace(/ /g, '_') as SignatoryRole)
          : SignatoryRole.COORDINATOR);
      return {
        signatory_name: sig.signatory_name || 'Unknown',
        signed_at: sig.signed_date ? new Date(sig.signed_date) : new Date(),
        signatory_role: role,
        signature_type: SignatureType.DIGITAL,
        ocr_detected: true,
      } as SignatureInfo;
    }) as SignatureInfo[],
    raw_data: { ...extracted, ocr_engine: ocrEngine, used_gemini_vision: usedGeminiVision, material_code: poParsed.material_code, mpo_revision: poParsed.mpo_revision },
    qty_shipped: (extracted as any).qty_shipped || undefined,
    ship_to: (extracted as any).ship_to || undefined,
    sold_to: (extracted as any).sold_to || undefined,
    line_items: (extracted as any).line_items || undefined,
    // Additional charges
    tt_charge: (extracted as any).tt_charge || undefined,
    courier_charges: (extracted as any).courier_charges || undefined,
    handling_fee: (extracted as any).handling_fee || undefined,
    finance_surcharge: (extracted as any).finance_surcharge || undefined,
    tax_amount: (extracted as any).tax_amount || undefined,
    discount_amount: (extracted as any).discount_amount || undefined,
    setup_charge: (extracted as any).setup_charge || undefined,
    sample_charge: (extracted as any).sample_charge || undefined,
    min_order_charge: (extracted as any).min_order_charge || undefined,
  };
}

export function inferServiceInvoiceCategory(extracted: any): InvoiceCategory {
  const searchable = [
    extracted?.vendor_name,
    extracted?.invoice_number,
    extracted?.description,
    extracted?.raw_text,
    extracted?.rawText,
    ...(Array.isArray(extracted?.line_items)
      ? extracted.line_items.flatMap((line: any) => [line?.description, line?.material_name])
      : []),
  ].filter(Boolean).join(' ').toUpperCase();

  if (/\b(FACTORY\s+AUDIT|AUDIT\s+(?:FEE|SERVICE|INSPECTION))\b/.test(searchable)) {
    return InvoiceCategory.FACTORY_AUDIT;
  }
  if (/\b(CONSULT(?:ING|ATION)?|PROFESSIONAL\s+SERVICE)\b/.test(searchable)) {
    return InvoiceCategory.CONSULTATION;
  }
  if (/\b(SF\s*EXPRESS|FEDEX|DHL|FREIGHT|SHIPPING|COURIER)\b/.test(searchable)) {
    return InvoiceCategory.SHIPPING_FREIGHT;
  }
  if (/\b(QIMA|IDFL|LAB(?:ORATORY)?|LAB\s+TESTING|TESTING\s+(?:FEE|SERVICE))\b/.test(searchable)) {
    return InvoiceCategory.LAB_TESTING;
  }

  return InvoiceCategory.TRIMS;
}
