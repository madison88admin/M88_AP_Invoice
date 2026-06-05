export enum InvoiceType {
  INV = 'INV',
  PI = 'PI',
  CI = 'CI',
  SI = 'SI',
  PREPAID = 'PREPAID',
}

export enum InvoiceCategory {
  TRIMS = 'TRIMS',
  YARN = 'YARN',
  SAMPLE_CHARGES = 'SAMPLE_CHARGES',
  SHIPPING_FREIGHT = 'SHIPPING_FREIGHT',
  LAB_TESTING = 'LAB_TESTING',
  PROFESSIONAL_FEE = 'PROFESSIONAL_FEE',
  OTHER = 'OTHER',
}

export enum InvoiceStatus {
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  VALIDATED = 'VALIDATED',
  EXCEPTION = 'EXCEPTION',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  POSTED = 'POSTED',
  PAYMENT_INITIATED = 'PAYMENT_INITIATED',
  PAID = 'PAID',
}

export enum SignatureRole {
  COORDINATOR = 'COORDINATOR',
  MANAGER = 'MANAGER',
  PLANNING_MANAGER = 'PLANNING_MANAGER',
  LINDSEY = 'LINDSEY',
}

export enum ExceptionReason {
  INVALID_BILL_TO = 'INVALID_BILL_TO',
  BANK_MISMATCH = 'BANK_MISMATCH',
  MISSING_SIGNATURE = 'MISSING_SIGNATURE',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
  NEXTGEN_MISMATCH = 'NEXTGEN_MISMATCH',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  LATE_SUBMISSION = 'LATE_SUBMISSION',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  URGENT_PAYMENT = 'URGENT_PAYMENT',
}

export enum PaymentBatchStatus {
  DRAFT = 'DRAFT',
  PENDING_CFO = 'PENDING_CFO',
  APPROVED = 'APPROVED',
  PROCESSED = 'PROCESSED',
}

export enum UserRole {
  PURCHASING_COORDINATOR = 'PURCHASING_COORDINATOR',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  ACCOUNTING_ASSOCIATE = 'ACCOUNTING_ASSOCIATE',
  ACCOUNTING_SUPERVISOR = 'ACCOUNTING_SUPERVISOR',
  PRESIDENT = 'PRESIDENT',
  CFO = 'CFO',
  IT_ADMIN = 'IT_ADMIN',
}

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: Date;
  invoice_due_date?: Date;
  invoice_received_date?: Date;
  vendor_id: string;
  vendor?: Vendor;
  amount: number;
  currency: string;
  payment_terms: string;
  incoterm?: string;
  bank_charges: number;
  shipping_charges: number;
  invoice_type: InvoiceType;
  category: InvoiceCategory;
  bill_to_name: string;
  bill_to_address: string;
  status: InvoiceStatus;
  priority: string;
  ocr_raw_data?: any;
  qb_invoice_id?: string;
  sharepoint_url?: string;
  signatures?: Signature[];
  audit_logs?: AuditLog[];
  exceptions?: Exception[];
  created_at: Date;
  updated_at: Date;
}

export interface Vendor {
  id: string;
  name: string;
  name_aliases: string[];
  expected_template: InvoiceType;
  bank_name: string;
  bank_address?: string;
  account_usd: string;
  account_hkd?: string;
  account_eur?: string;
  swift_code: string;
  bank_code?: string;
  currency: string;
  invoices?: Invoice[];
}

export interface Signature {
  id: string;
  invoice_id: string;
  signer_name: string;
  signed_at?: Date;
  role: SignatureRole;
  ocr_detected: boolean;
}

export interface AuditLog {
  id: string;
  invoice_id: string;
  user_id?: string;
  action: string;
  metadata?: any;
  created_at: Date;
}

export interface Exception {
  id: string;
  invoice_id: string;
  reason: ExceptionReason;
  detail: string;
  resolved_by?: string;
  resolution_notes?: string;
  resolved_at?: Date;
  created_at: Date;
}

export interface PaymentBatch {
  id: string;
  invoice_ids: string[];
  total_amount: number;
  currency: string;
  initiated_by: string;
  cfo_approved_by?: string;
  status: PaymentBatchStatus;
  confirmation_url?: string;
  approved_at?: Date;
  created_at: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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
  bank_info: {
    bank_name: string;
    swift_code: string;
    account_usd: string;
    account_hkd?: string;
    account_eur?: string;
    bank_address?: string;
  };
  invoice_type: InvoiceType;
  signatures: Array<{
    signer_name: string;
    signed_at?: Date;
    role: SignatureRole;
  }>;
  raw_data: any;
}

export interface ValidationRuleResult {
  rule_name: string;
  passed: boolean;
  reason?: string;
  exception?: ExceptionReason;
}

export interface ApprovalRequest {
  invoice_id: string;
  approver_id: string;
  action: 'approve' | 'reject';
  comments: string;
}
