/**
 * Shared TypeScript interfaces for the invoice extraction pipeline.
 */

import { SignatoryRole, SignatureType } from '@ap-invoice/shared';

export interface FieldExtraction {
  value: any;
  confidence: number;
  source_text: string | null;
  method: 'regex' | 'heuristic' | 'ai' | 'fallback' | 'sum_heuristic' | 'ast';
  candidates?: Array<{ value: any; score: number; reason: string }>;
}

export interface ExtractionTrace {
  vendor_name?: FieldExtraction;
  invoice_number?: FieldExtraction;
  invoice_date?: FieldExtraction;
  due_date?: FieldExtraction;
  amount?: FieldExtraction;
  currency?: FieldExtraction;
  mpo_number?: FieldExtraction;
  payment_terms?: FieldExtraction;
  bank_name?: FieldExtraction;
  swift_code?: FieldExtraction;
  account_number?: FieldExtraction;
  qty_shipped?: FieldExtraction;
}

export interface ExtractedSignature {
  signatory_name: string;
  signed_at?: Date;
  signatory_role: SignatoryRole;
  signature_type: SignatureType;
}

export interface MadisonInvoiceExtraction {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount: number | null;
  grand_total: number | null;
  currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
  settlement_currency: 'USD' | 'HKD' | 'IDR' | 'EUR' | 'PHP' | 'JPY' | null;
  needs_currency_confirmation: boolean;
  bank_charge: number | null;
  freight_charges: number | null;
  additional_charges: number | null;
  subtotal: number | null;
  tax_amount: number | null;
  discount_amount: number | null;
  invoice_received_date: string | null;
  payment_terms: string | null;
  incoterm: string | null;
  signatures: ExtractedSignature[];
  ship_to: string | null;
  sold_to: string | null;
  bank_details: {
    bank_name: string | null;
    swift_code: string | null;
    account_number: string | null;
    account_usd: string | null;
    account_hkd: string | null;
    account_eur: string | null;
    account_vnd: string | null;
    account_idr: string | null;
    account_php: string | null;
    account_jpy: string | null;
    account_gbp: string | null;
    account_cny: string | null;
    account_aud: string | null;
    account_cad: string | null;
    account_sgd: string | null;
    intermediary_bank_name: string | null;
    intermediary_bank_swift: string | null;
  };
  bill_to_text: string | null;
  bill_to_confirmed_madison88: boolean;
  document_type: 'INV' | 'PI' | 'CI' | 'SI' | 'STATEMENT' | null;

  po_reference_raw: string | null;
  brand: string | null;
  brand_code: string | null;
  season: string | null;
  order_type: 'BULK' | 'SMS' | 'SAMPLE' | null;
  po_number: string | null;
  mpo_number: string | null;

  category: 'TRIMS' | 'YARN' | 'SAMPLE' | 'SHIPPING' | 'LAB' | null;
  qty_shipped: number | null;
  notes: string | null;
  is_handwritten: boolean;
  status: 'EXTRACTED' | 'REVIEW_REQUIRED' | 'AST_FAILURE';
  status_reason?: string;

  raw_text: string;
  extraction_trace: ExtractionTrace;
  overall_confidence: number;

  amount_resolution_debug?: {
    method: string;
    confidence: number;
    score: number | null;
    topCandidates: Array<{ amount: number; label: string; score: number; page: number }>;
    internalLineItems?: Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }>;
    internalLineItemSum?: number;
  };
}

export interface PDFPage {
  Texts: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    R: Array<{ T: string }>;
  }>;
}

export interface PDFData {
  Pages: PDFPage[];
}

export interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PDFTextExtraction {
  fullText: string;
  pages: string[];
  pageItems: PDFTextItem[][];
}

export interface VendorDetection {
  vendor: string;
  confidence: number;
}

export interface ExtractedLineItem {
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  rawLine: string;
}
