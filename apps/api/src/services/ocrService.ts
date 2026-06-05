import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { InvoiceType, InvoiceCategory } from '@ap-invoice/shared';
import { detectInvoiceType, detectCategory, detectPaymentTerms, detectIncoterm, isUrgent } from '@ap-invoice/shared';

const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT || '';
const apiKey = process.env.AZURE_FORM_RECOGNIZER_KEY || '';

if (!endpoint || !apiKey) {
  console.warn('Azure Form Recognizer credentials not configured');
}

const client = endpoint && apiKey 
  ? new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey))
  : null;

export interface BankInfo {
  bank_name: string;
  swift_code: string;
  account_usd: string;
  account_hkd?: string;
  account_eur?: string;
  bank_address?: string;
}

export interface SignatureInfo {
  signer_name: string;
  signed_at?: Date;
  role: string;
}

export interface OCRResult {
  invoice_number: string;
  invoice_date: Date;
  due_date?: Date;
  vendor_name: string;
  amount: number;
  currency: string;
  payment_terms: string;
  incoterm?: string;
  category: InvoiceCategory;
  bill_to_name: string;
  bill_to_address: string;
  bank_info: BankInfo;
  invoice_type: InvoiceType;
  signatures: SignatureInfo[];
  raw_data: any;
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
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
    const invoice_number = fields?.InvoiceId?.content || '';
    const invoice_date = fields?.InvoiceDate?.content ? new Date(fields.InvoiceDate.content) : new Date();
    const due_date = fields?.DueDate?.content ? new Date(fields.DueDate.content) : undefined;
    const vendor_name = fields?.VendorName?.content || '';
    const amount = fields?.InvoiceTotal?.content ? parseFloat(fields.InvoiceTotal.content) : 0;
    const currency = fields?.CurrencyCode?.content || 'USD';
    const bill_to_name = fields?.CustomerName?.content || '';
    const bill_to_address = fields?.BillingAddress?.content || '';

    // Extract full text for custom parsing
    const fullText = result.pages?.map(page => 
      page.lines?.map(line => line.content).join('\n') || ''
    ).join('\n') || '';

    // Custom field extraction
    const invoice_type = detectInvoiceType(fullText);
    const category = detectCategory(fullText);
    const payment_terms = detectPaymentTerms(fullText);
    const incoterm = detectIncoterm(fullText);
    const priority = isUrgent(fullText) ? 'URGENT' : 'NORMAL';

    // Extract bank information from remittance section
    const bank_info = extractBankInfo(fields, fullText);

    // Extract signatures
    const signatures = extractSignatures(fields, fullText);

    return {
      invoice_number,
      invoice_date,
      due_date,
      vendor_name,
      amount,
      currency,
      payment_terms,
      incoterm,
      category,
      bill_to_name,
      bill_to_address,
      bank_info,
      invoice_type,
      signatures,
      raw_data: result,
      priority,
    };
  } catch (error) {
    console.error('Error analyzing invoice:', error);
    throw new Error(`Failed to analyze invoice: ${error}`);
  }
}

function extractBankInfo(fields: any, fullText: string): BankInfo {
  const bankInfo: BankInfo = {
    bank_name: '',
    swift_code: '',
    account_usd: '',
    account_hkd: undefined,
    account_eur: undefined,
    bank_address: undefined,
  };

  // Try to extract from Form Recognizer fields
  if (fields?.RemittanceAddress) {
    const remittanceText = fields.RemittanceAddress.content || '';
    bankInfo.bank_address = remittanceText;
  }

  // Custom parsing from full text for bank details
  const lines = fullText.split('\n');
  
  for (const line of lines) {
    const upperLine = line.toUpperCase();
    
    // Extract SWIFT code
    const swiftMatch = upperLine.match(/SWIFT[:\s]*([A-Z]{6}[A-Z0-9]{2})/i);
    if (swiftMatch) {
      bankInfo.swift_code = swiftMatch[1];
    }

    // Extract bank name
    if (upperLine.includes('BANK') && !bankInfo.bank_name) {
      bankInfo.bank_name = line.trim();
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
      } else if (!bankInfo.account_usd) {
        bankInfo.account_usd = accountNum;
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
      currentSignature.signed_at = new Date(dateMatch[1]);
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
  }

  if (currentSignature.signer_name) {
    signatures.push(currentSignature as SignatureInfo);
  }

  return signatures;
}
