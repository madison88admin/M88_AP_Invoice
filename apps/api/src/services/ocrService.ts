import PDFParser from 'pdf2json';
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

  let amount = 0;

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

  // Final fallback: if still 0, use the last non-zero decimal number
  if (amount === 0) {
    const allAmounts = text.match(/[\d,]+\.\d{2}/g);
    logger.info(`[OCR] All decimal amounts found: ${JSON.stringify(allAmounts)}`);
    if (allAmounts && allAmounts.length > 0) {
      const parsedAmounts = allAmounts.map(a => parseFloat(a.replace(/,/g, '')));
      const nonZeroAmounts = parsedAmounts.filter(a => a > 0);
      if (nonZeroAmounts.length > 0) {
        amount = nonZeroAmounts[nonZeroAmounts.length - 1];
        logger.info(`[OCR] Amount extracted as last non-zero decimal number: ${amount}`);
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

export async function analyzeInvoice(fileBuffer: Buffer, mimeType: string) {
  const extracted = await extractInvoiceFields(fileBuffer);
  const poParsed = extracted.po_reference ? parsePOReference(extracted.po_reference) : {};

  return {
    invoice_number: extracted.invoice_number || '',
    invoice_date: extracted.invoice_date ? new Date(extracted.invoice_date) : new Date(),
    due_date: extracted.due_date ? new Date(extracted.due_date) : undefined,
    invoice_received_date: new Date(),
    vendor_name: extracted.vendor_name || '',
    total_amount: extracted.amount || 0,
    currency: extracted.currency || 'USD',
    payment_terms: extracted.payment_terms || PaymentTerms.NET_30,
    incoterm: undefined,
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    invoice_type: extracted.invoice_type as InvoiceType || InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: poParsed.order_type as OrderType | undefined,
    brand: poParsed.brand_code ? (TOP_10_BRANDS[poParsed.brand_code] || poParsed.brand_code) : undefined,
    brand_code: poParsed.brand_code,
    season: poParsed.season,
    mpo_number: poParsed.mpo_number || extracted.mpo_number,
    customer_po_number: poParsed.po_number,
    bill_to_entity: BillToEntity.MADISON_88_LTD,
    is_handwritten: false,
    is_urgent: false,
    priority_pay_date: undefined,
    ocr_confidence_score: 0.9,
    qb_memo: undefined,
    qb_account_class: undefined,
    bank_info: {
      swift_code: extracted.bank_swift,
      account_usd: extracted.bank_account,
    },
    signatures: [],
    raw_data: extracted,
  };
}
