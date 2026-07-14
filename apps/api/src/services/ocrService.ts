import PDFParser from 'pdf2json';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InvoiceType, InvoiceCategory, PaymentTerms, BillToEntity, OrderType, SignatoryRole, SignatureType } from '@ap-invoice/shared';
import { parsePOReference, matchSignerToRole, TOP_10_BRANDS, isTop10Brand } from '@ap-invoice/shared';
import { logger } from '../utils/logger';

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
  return new Promise((resolve, reject) => {
    const pdfParser = new (PDFParser as any)(null, 1);
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        const text = pdfData.Pages
          .map((page: any) => 
            page.Texts
              .map((t: any) => decodeURIComponent(t.R[0].T))
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
  console.log('[OCR] Using pdf2json (local, no external APIs)');
  const text = await extractTextFromPDF(fileBuffer);
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
    /INVOICE\s*NO[:\s#]*([A-Z0-9\-\/]+)/i,
    /INVOICE\s*NUMBER[:\s#]*([A-Z0-9\-\/]+)/i,
    /INV(?:OICE)?\s*#[:\s]*([A-Z0-9\-\/]+)/i,
    /Invoice\s*#[:\s]*([A-Z0-9\-\/]+)/i,
    /Bill\s*No[:\s]*([A-Z0-9\-\/]+)/i,
    /Bill\s*Number[:\s]*([A-Z0-9\-\/]+)/i,
    /BILL\s*TO[:\s\.:]*[\s\n]*([A-Z]{2,4}[-\s]*\d{4,10})/i, // Invoice number after BILL TO (e.g., PCI-26018341)
    /Ref[:\s#]*([A-Z0-9\-\/]+)/i,
    /Reference[:\s#]*([A-Z0-9\-\/]+)/i,
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
    /Date[:\s]*(\d{2}-[A-Z]{3}-\d{4})/i,
    /Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Date[:\s]*(\d{4}-\d{2}-\d{2})/i,
    /Issued\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Billing\s*Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
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
    /Due\s*by[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Payment\s*Due[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  let due_date = '';
  for (const pattern of dueDatePatterns) {
    const m = text.match(pattern);
    if (m) { due_date = m[1]; break; }
  }

  // amount — multiple patterns for different layouts and brands
  const amountPatterns = [
    /TOTAL\s*\(USD\)\s*([\d,]+\.\d{2})/i,
    /TOTAL\s*USD\s*([\d,]+\.\d{2})/i,
    /TOTAL\s*USD[\s\S]{0,150}([\d,]+\.\d{2})/i, // TOTAL USD followed by amount within 150 chars (handles different cells)
    /TOTAL\s*USD/i, // Match TOTAL USD, then find amount nearby
    /TOTAL\s*(?:AMOUNT)?[:\s]*([\d,]+\.\d{2})/i,
    /Grand\s*Total[:\s]*([\d,]+\.\d{2})/i,
    /GrandTotal[:\s]*([\d,]+\.\d{2})/i,
    /Net\s*Amount[:\s]*([\d,]+\.\d{2})/i,
    /Net\s*Total[:\s]*([\d,]+\.\d{2})/i,
    /Amount[:\s]*([\d,]+\.\d{2})/i,
    /Balance\s*Due[:\s]*([\d,]+\.\d{2})/i,
    /Subtotal[:\s]*([\d,]+\.\d{2})/i,
    /Total[:\s]*([\d,]+\.\d{2})/i,
    /USD\s*([\d,]+\.\d{2})/i, // Just USD followed by amount
    /([\d,]+\.\d{2})\s*USD/i, // Amount followed by USD
  ];

  const grandTotalPatterns = [
    /Grand\s*Total\s*(?:USD|HKD|EUR|GBP|PHP|JPY|IDR)?\s*[:\s]*([\d,]+\.\d{2})/i,
    /GrandTotal\s*[:\s]*([\d,]+\.\d{2})/i,
    /Grand\s*Total\s*[:\s]*([\d,]+\.\d{2})/i,
  ];

  let amount = 0;
  let grand_total = 0;

  // Prose-based currency extraction (e.g., "settle in USD 96.68")
  const prosePatterns = [
    /settle\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2})/i,
    /payment\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2})/i,
    /for\s+settlement\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)[^0-9]*([\d,]+\.\d{2})/i,
    /please\s+settle\s+in\s+(?:USD|HKD|EUR|GBP|PHP|JPY|IDR|VND|CNY|SGD|AUD|CAD|CHF|MYR|THB|KRW|TWD)\s+([\d,]+\.\d{2})/i,
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
      const amountMatch = searchRange.match(/([\d,]+\.\d{2})/);
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
    const allAmounts = text.match(/[\d,]+\.\d{2}/g);
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
    /Account\s*#[:\s]*([\d\-]+)/i,
    /A\/C\s*No[:\s]*([\d\-]+)/i,
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
  if (/proforma|pro-forma|pro forma/i.test(text)) invoiceType = 'PROFORMA';
  else if (/commercial\s*invoice/i.test(text)) invoiceType = 'COMMERCIAL';
  else if (/sales\s*invoice/i.test(text)) invoiceType = 'SALES';
  else if (/credit\s*note/i.test(text)) invoiceType = 'CREDIT_NOTE';
  else if (/statement|account\s*statement|aging|aged\s*balance/i.test(text)) invoiceType = 'STATEMENT';

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
    company_reg: company_reg
  };

  console.log('[DEBUG] Extracted fields:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Convert PDF to PNG image using pdftoppm (poppler-utils).
 * Returns base64-encoded image string, or null if conversion fails.
 */
function convertPDFToImage(fileBuffer: Buffer): string | null {
  const tmpDir = os.tmpdir();
  const tmpPdf = path.join(tmpDir, `invoice_${Date.now()}.pdf`);
  const tmpImgPrefix = path.join(tmpDir, `invoice_${Date.now()}`);

  try {
    fs.writeFileSync(tmpPdf, fileBuffer);
    logger.info(`[OCR] Converting PDF to image using pdftoppm...`);

    // Convert first page to PNG at 200 DPI
    execSync(`pdftoppm -png -r 200 -f 1 -l 1 "${tmpPdf}" "${tmpImgPrefix}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    // Find the generated image file
    const imgFile = `${tmpImgPrefix}-1.png`;
    if (!fs.existsSync(imgFile)) {
      // Try alternative naming
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(tmpImgPrefix)));
      if (files.length === 0) {
        logger.error('[OCR] PDF-to-image conversion produced no output files');
        return null;
      }
      const imgPath = path.join(tmpDir, files[0]);
      const imgBuffer = fs.readFileSync(imgPath);
      const base64 = imgBuffer.toString('base64');
      fs.unlinkSync(imgPath);
      return base64;
    }

    const imgBuffer = fs.readFileSync(imgFile);
    const base64 = imgBuffer.toString('base64');
    fs.unlinkSync(imgFile);
    logger.info(`[OCR] PDF-to-image conversion succeeded (${(base64.length / 1024).toFixed(0)}KB base64)`);
    return base64;
  } catch (error) {
    logger.error('[OCR] PDF-to-image conversion failed:', error);
    return null;
  } finally {
    try { fs.unlinkSync(tmpPdf); } catch {}
  }
}

/**
 * Try AI fallback OCR engines in order: Gemini Vision → Ollama (Qwen) → Groq (Llama)
 * Returns the first successful result with engine name, or null if all fail.
 */
async function tryAIFallbacks(
  fileBuffer: Buffer,
  rawText: string
): Promise<{ engine: string; vendor_name?: string; invoice_number?: string; invoice_date?: string; due_date?: string; total_amount?: number; subtotal?: number; currency?: string; po_number?: string; mpo_number?: string; brand?: string; brand_code?: string; season?: string; payment_terms?: string; ship_to?: string; sold_to?: string; qty_shipped?: number; document_type?: string; bank_name?: string; swift_code?: string; account_number?: string; bank_info?: { swift_code?: string; account_number?: string }; line_items?: any[]; bank_charges?: number; tt_charge?: number; freight_charges?: number; courier_charges?: number; handling_fee?: number; finance_surcharge?: number; tax_amount?: number; discount_amount?: number; setup_charge?: number; sample_charge?: number; min_order_charge?: number; additional_charges?: number } | null> {
  // 1st fallback: Gemini Vision (sends PDF as file directly — best for visual layout)
  try {
    const geminiOCR = (await import('./geminiOCRService')).geminiOCRService;
    if (geminiOCR.isAvailable()) {
      logger.info('[OCR] Trying Gemini Vision fallback...');
      const geminiResult = await geminiOCR.extractFromPDF(fileBuffer);
      if (geminiResult && (geminiResult.vendor_name || geminiResult.invoice_number)) {
        logger.info('[OCR] Gemini Vision fallback succeeded');
        return { engine: 'gemini', ...geminiResult };
      }
    }
  } catch (e) {
    logger.error('[OCR] Gemini Vision fallback failed:', e);
  }

  // 2nd fallback: Ollama (Qwen 2.5 VL — local, uses raw text from pdf2json)
  if (rawText && rawText.length > 50) {
    try {
      const ollamaOCR = (await import('./ollamaOCRService')).ollamaOCRService;
      if (ollamaOCR.isAvailable()) {
        logger.info('[OCR] Trying Ollama (Qwen) fallback with raw text...');
        const ollamaResult = await ollamaOCR.extractFromText(rawText, {});
        if (ollamaResult && (ollamaResult.vendor_name || ollamaResult.invoice_number)) {
          logger.info('[OCR] Ollama (Qwen) text fallback succeeded');
          return { engine: 'ollama', ...ollamaResult };
        }
      }
    } catch (e) {
      logger.error('[OCR] Ollama text fallback failed:', e);
    }
  } else {
    logger.warn('[OCR] No raw text from pdf2json — trying PDF-to-image conversion for Ollama vision...');
    // Convert PDF to image and try Ollama vision model
    const imageBase64 = convertPDFToImage(fileBuffer);
    if (imageBase64) {
      try {
        const ollamaOCR = (await import('./ollamaOCRService')).ollamaOCRService;
        if (ollamaOCR.isAvailable()) {
          logger.info('[OCR] Trying Ollama (Qwen) vision fallback with PDF image...');
          const ollamaResult = await ollamaOCR.extractFromImage(imageBase64, {});
          if (ollamaResult && (ollamaResult.vendor_name || ollamaResult.invoice_number)) {
            logger.info('[OCR] Ollama (Qwen) vision fallback succeeded');
            return { engine: 'ollama-vision', ...ollamaResult };
          }
        }
      } catch (e) {
        logger.error('[OCR] Ollama vision fallback failed:', e);
      }
    }
  }

  // 3rd fallback: Groq (Llama 3.3 70B — uses raw text)
  if (rawText && rawText.length > 50) {
    try {
      const groqOCR = (await import('./groqOCRService')).groqOCRService;
      if (groqOCR.isAvailable()) {
        logger.info('[OCR] Trying Groq (Llama) fallback with raw text...');
        const groqResult = await groqOCR.extractFromText(rawText, undefined);
        if (groqResult && (groqResult.vendor_name || groqResult.invoice_number)) {
          logger.info('[OCR] Groq (Llama) fallback succeeded');
          return { engine: 'groq', ...groqResult };
        }
      }
    } catch (e) {
      logger.error('[OCR] Groq fallback failed:', e);
    }
  }

  return null;
}

export async function analyzeInvoice(fileBuffer: Buffer, mimeType: string) {
  let extracted: Awaited<ReturnType<typeof extractInvoiceFields>>;
  let usedGeminiVision = false;
  let usedAIFallback = false;
  let ocrEngine = 'pdf2json';

  // Try pdf2json first
  let pdf2jsonRawText = '';
  try {
    extracted = await extractInvoiceFields(fileBuffer);
    // Also get raw text for AI fallbacks if needed
    try {
      pdf2jsonRawText = await extractTextFromPDF(fileBuffer);
    } catch {
      // If we can't get raw text separately, use the extracted fields as-is
    }

    // Quality check: are critical fields missing or invalid?
    const criticalFieldsMissing =
      !extracted.vendor_name ||
      extracted.vendor_name.trim() === '' ||
      extracted.vendor_name === 'Account No' ||
      !extracted.invoice_number ||
      extracted.invoice_number.trim() === '';

    if (criticalFieldsMissing) {
      logger.warn(`[OCR] pdf2json extracted but critical fields missing (vendor="${extracted.vendor_name}", invoice#="${extracted.invoice_number}"). Triggering AI fallback chain.`);

      // Try AI fallbacks using the raw text from pdf2json
      const fallbackResult = await tryAIFallbacks(fileBuffer, pdf2jsonRawText);

      if (fallbackResult) {
        usedAIFallback = true;
        ocrEngine = fallbackResult.engine;
        extracted = {
          vendor_name: fallbackResult.vendor_name || '',
          invoice_number: fallbackResult.invoice_number || '',
          invoice_date: fallbackResult.invoice_date ? new Date(fallbackResult.invoice_date).toISOString().split('T')[0] : '',
          due_date: fallbackResult.due_date ? new Date(fallbackResult.due_date).toISOString().split('T')[0] : '',
          amount: fallbackResult.total_amount || 0,
          grand_total: 0,
          currency: fallbackResult.currency || 'USD',
          po_reference: fallbackResult.po_number || '',
          mpo_number: fallbackResult.mpo_number || '',
          brand_code: fallbackResult.brand_code || '',
          payment_terms: fallbackResult.payment_terms || '',
          bank_swift: fallbackResult.swift_code || fallbackResult.bank_info?.swift_code || '',
          bank_account: fallbackResult.account_number || fallbackResult.bank_info?.account_number || '',
          invoice_type: (fallbackResult.document_type as any) || 'INVOICE',
          tax_id: '',
          company_reg: '',
        };
        // Store extra AI-extracted fields for downstream use
        (extracted as any).qty_shipped = fallbackResult.qty_shipped;
        (extracted as any).bank_name = fallbackResult.bank_name;
        (extracted as any).ship_to = fallbackResult.ship_to;
        (extracted as any).sold_to = fallbackResult.sold_to;
        (extracted as any).brand = fallbackResult.brand;
        (extracted as any).season = fallbackResult.season;
        (extracted as any).line_items = fallbackResult.line_items;
        // Charges
        (extracted as any).subtotal = fallbackResult.subtotal;
        (extracted as any).bank_charges = fallbackResult.bank_charges;
        (extracted as any).tt_charge = fallbackResult.tt_charge;
        (extracted as any).freight_charges = fallbackResult.freight_charges;
        (extracted as any).courier_charges = fallbackResult.courier_charges;
        (extracted as any).handling_fee = fallbackResult.handling_fee;
        (extracted as any).finance_surcharge = fallbackResult.finance_surcharge;
        (extracted as any).tax_amount = fallbackResult.tax_amount;
        (extracted as any).discount_amount = fallbackResult.discount_amount;
        (extracted as any).setup_charge = fallbackResult.setup_charge;
        (extracted as any).sample_charge = fallbackResult.sample_charge;
        (extracted as any).min_order_charge = fallbackResult.min_order_charge;
        (extracted as any).additional_charges = fallbackResult.additional_charges;
        logger.info(`[OCR] AI fallback succeeded with ${ocrEngine} — vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}"`);
      } else {
        logger.warn('[OCR] All AI fallbacks failed — using pdf2json results as-is');
      }
    }
  } catch (pdfError) {
    console.error('[OCR] pdf2json failed, trying AI fallbacks:', pdfError);
    logger.error('[OCR] pdf2json parse failed, attempting AI fallback chain');

    // pdf2json completely failed — try to get raw text for AI services
    // If pdf2json can't parse at all, AI text-based services won't have text either
    // Gemini Vision can still read the PDF directly
    const fallbackResult = await tryAIFallbacks(fileBuffer, '');

    if (fallbackResult) {
      usedAIFallback = true;
      ocrEngine = fallbackResult.engine;
      if (fallbackResult.engine === 'gemini') {
        usedGeminiVision = true;
      }
      extracted = {
        vendor_name: fallbackResult.vendor_name || '',
        invoice_number: fallbackResult.invoice_number || '',
        invoice_date: fallbackResult.invoice_date ? new Date(fallbackResult.invoice_date).toISOString().split('T')[0] : '',
        due_date: fallbackResult.due_date ? new Date(fallbackResult.due_date).toISOString().split('T')[0] : '',
        amount: fallbackResult.total_amount || 0,
        grand_total: 0,
        currency: fallbackResult.currency || 'USD',
        po_reference: fallbackResult.po_number || '',
        mpo_number: fallbackResult.mpo_number || '',
        brand_code: fallbackResult.brand_code || '',
        payment_terms: fallbackResult.payment_terms || '',
        bank_swift: fallbackResult.swift_code || fallbackResult.bank_info?.swift_code || '',
        bank_account: fallbackResult.account_number || fallbackResult.bank_info?.account_number || '',
        invoice_type: (fallbackResult.document_type as any) || 'INVOICE',
        tax_id: '',
        company_reg: '',
      };
      // Store extra AI-extracted fields for downstream use
      (extracted as any).qty_shipped = fallbackResult.qty_shipped;
      (extracted as any).bank_name = fallbackResult.bank_name;
      (extracted as any).ship_to = fallbackResult.ship_to;
      (extracted as any).sold_to = fallbackResult.sold_to;
      (extracted as any).brand = fallbackResult.brand;
      (extracted as any).season = fallbackResult.season;
      (extracted as any).line_items = fallbackResult.line_items;
      // Charges
      (extracted as any).subtotal = fallbackResult.subtotal;
      (extracted as any).bank_charges = fallbackResult.bank_charges;
      (extracted as any).tt_charge = fallbackResult.tt_charge;
      (extracted as any).freight_charges = fallbackResult.freight_charges;
      (extracted as any).courier_charges = fallbackResult.courier_charges;
      (extracted as any).handling_fee = fallbackResult.handling_fee;
      (extracted as any).finance_surcharge = fallbackResult.finance_surcharge;
      (extracted as any).tax_amount = fallbackResult.tax_amount;
      (extracted as any).discount_amount = fallbackResult.discount_amount;
      (extracted as any).setup_charge = fallbackResult.setup_charge;
      (extracted as any).sample_charge = fallbackResult.sample_charge;
      (extracted as any).min_order_charge = fallbackResult.min_order_charge;
      (extracted as any).additional_charges = fallbackResult.additional_charges;
      logger.info(`[OCR] AI fallback succeeded with ${ocrEngine} after pdf2json failure`);
    } else {
      throw pdfError; // All fallbacks failed, rethrow original error
    }
  }

  logger.info(`[OCR] Final extraction — engine: ${ocrEngine}, vendor: "${extracted.vendor_name}", invoice#: "${extracted.invoice_number}", amount: ${extracted.amount}`);

  const poParsed = extracted.po_reference ? parsePOReference(extracted.po_reference) : {};

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
    invoice_type: extracted.invoice_type as InvoiceType || InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: poParsed.order_type as OrderType | undefined,
    brand: poParsed.brand_code ? (TOP_10_BRANDS[poParsed.brand_code] || poParsed.brand_code) : (extracted as any).brand || undefined,
    brand_code: poParsed.brand_code || extracted.brand_code || undefined,
    season: poParsed.season || (extracted as any).season || undefined,
    mpo_number: poParsed.mpo_number || extracted.mpo_number,
    customer_po_number: poParsed.po_number,
    bill_to_entity: BillToEntity.MADISON_88_LTD,
    is_handwritten: false,
    is_urgent: false,
    priority_pay_date: undefined,
    ocr_confidence_score: usedAIFallback ? 0.95 : (extracted.vendor_name && extracted.invoice_number ? 0.9 : 0.5),
    qb_memo: undefined,
    qb_account_class: undefined,
    bank_info: {
      bank_name: (extracted as any).bank_name || undefined,
      swift_code: extracted.bank_swift,
      account_usd: extracted.bank_account,
    },
    signatures: [] as SignatureInfo[],
    raw_data: { ...extracted, ocr_engine: ocrEngine, used_gemini_vision: usedGeminiVision, material_code: poParsed.material_code, mpo_suffix: poParsed.mpo_suffix },
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
