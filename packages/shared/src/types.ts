export enum InvoiceType {
  INV = 'INV',
  PI = 'PI',
  CI = 'CI',
  SI = 'SI',
  PREPAID = 'PREPAID',
  STATEMENT = 'STATEMENT',
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

export enum OrderType {
  BULK = 'BULK',
  SMS = 'SMS',
  SAMPLE = 'SAMPLE',
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
  PI_PENDING_CI = 'PI_PENDING_CI',
}

export enum PaymentTerms {
  NET_7 = 'NET_7',
  NET_30 = 'NET_30',
  NET_45 = 'NET_45',
  NET_60 = 'NET_60',
  NET_90 = 'NET_90',
  WITHIN_15_DAYS = 'WITHIN_15_DAYS',
  PAYMENT_IN_ADVANCE = 'PAYMENT_IN_ADVANCE',
  TT_100_BEFORE_SHIPMENT = 'TT_100_BEFORE_SHIPMENT',
  PBS = 'PBS',
  ARD = 'ARD',
  CHEQUE_30 = 'CHEQUE_30',
  SPLIT_50_50 = 'SPLIT_50_50',
  PREPAID = 'PREPAID',
  COD = 'COD',
  OTHER = 'OTHER',
}

export enum SignatureRole {
  COORDINATOR = 'COORDINATOR',
  MANAGER = 'MANAGER',
  PLANNING_MANAGER = 'PLANNING_MANAGER',
  LINDSEY = 'LINDSEY',
  POLLY = 'POLLY',
}

export enum ApprovalStage {
  PURCHASING_COORDINATOR = 'PURCHASING_COORDINATOR',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  PLANNING_MANAGER = 'PLANNING_MANAGER',
  LINDSEY = 'LINDSEY',
  POLLY = 'POLLY',
  ACCOUNTING = 'ACCOUNTING',
}

export enum ExceptionReason {
  INVALID_BILL_TO = 'INVALID_BILL_TO',
  BANK_MISMATCH = 'BANK_MISMATCH',
  MISSING_BANK_INFO = 'MISSING_BANK_INFO',
  MISSING_SIGNATURE = 'MISSING_SIGNATURE',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  LATE_SUBMISSION = 'LATE_SUBMISSION',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  URGENT_PAYMENT = 'URGENT_PAYMENT',
  HANDWRITTEN_DOCUMENT = 'HANDWRITTEN_DOCUMENT',
  MISSING_ADDRESS = 'MISSING_ADDRESS',
  MULTIPLE_BANK_ACCOUNTS = 'MULTIPLE_BANK_ACCOUNTS',
  INVALID_INVOICE_NUMBER = 'INVALID_INVOICE_NUMBER',
  INVALID_INVOICE_DATE = 'INVALID_INVOICE_DATE',
  INVALID_DUE_DATE = 'INVALID_DUE_DATE',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  INVALID_CURRENCY = 'INVALID_CURRENCY',
  INVALID_PAYMENT_TERMS = 'INVALID_PAYMENT_TERMS',
  INVALID_INCOTERM = 'INVALID_INCOTERM',
  ENTITY_MISMATCH = 'ENTITY_MISMATCH',
}

export enum MadisonEntity {
  MADISON_88_LTD = 'MADISON_88_LTD',
  MADISON_88_LIMITED = 'MADISON_88_LIMITED',
  MADISON_88_NEW_YORK = 'MADISON_88_NEW_YORK',
  MADISON_88_HONG_KONG_LIMITED = 'MADISON_88_HONG_KONG_LIMITED',
}

export enum PaymentBatchStatus {
  DRAFT = 'DRAFT',
  PENDING_CFO = 'PENDING_CFO',
  APPROVED = 'APPROVED',
  PROCESSED = 'PROCESSED',
}

export enum UserRole {
  ADMIN = 'ADMIN',
  ACCOUNTING_ASSOCIATE = 'ACCOUNTING_ASSOCIATE',
  ACCOUNTING_SUPERVISOR = 'ACCOUNTING_SUPERVISOR',
  PURCHASING_COORDINATOR = 'PURCHASING_COORDINATOR',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  PLANNING_MANAGER = 'PLANNING_MANAGER',
  LINDSEY = 'LINDSEY',
  POLLY = 'POLLY',
  CFO = 'CFO',
  PRESIDENT = 'PRESIDENT',
  IT_ADMIN = 'IT_ADMIN',
}

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: Date;
  invoice_due_date?: Date;
  invoice_received_date?: Date;
  date_range_start?: Date;
  date_range_end?: Date;
  invoice_version?: string;
  invoice_version_notes?: string;
  parent_invoice_id?: string;
  vendor_id: string;
  vendor?: Vendor;
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
  bill_to_entity: MadisonEntity;
  final_approver_name?: string;
  final_approval_date?: Date;
  is_handwritten: boolean;
  is_priority: boolean;
  priority_pay_date?: Date;
  payment_consolidation_note?: string;
  qb_memo?: string;
  qb_account_class?: string;
  qb_invoice_id?: string;
  sharepoint_url?: string;
  status: InvoiceStatus;
  ocr_raw_data: any;
  signatures?: Signature[];
  audit_logs?: AuditLog[];
  exceptions?: Exception[];
  stage_timestamps?: StageTimestamp[];
  created_at: Date;
  updated_at: Date;
}

export interface Vendor {
  id: string;
  name: string;
  name_aliases: string[];
  expected_template: InvoiceType;
  supplier_location?: string;
  bank_name?: string;
  bank_address?: string;
  account_usd?: string;
  account_hkd?: string;
  account_eur?: string;
  iban?: string;
  sort_code?: string;
  aba_routing_number?: string;
  swift_code?: string;
  bank_code?: string;
  intermediary_bank_name?: string;
  intermediary_bank_swift?: string;
  has_multiple_accounts: boolean;
  default_account_id?: string;
  vat_number?: string;
  eori_number?: string;
  gstin_number?: string;
  bir_tin?: string;
  payment_penalty_rate?: number;
  currency: string;
  invoices?: Invoice[];
}

export interface Signature {
  id: string;
  invoice_id: string;
  signer_name: string;
  signed_at?: Date;
  role: SignatureRole;
  is_digital: boolean;
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

export interface StageTimestamp {
  id: string;
  invoice_id: string;
  stage: ApprovalStage;
  entered_at: Date;
  exited_at?: Date;
  duration_hours?: number;
  sla_hours: number;
  is_breached: boolean;
}

export interface PaymentBatch {
  id: string;
  invoice_ids: string[];
  total_amount: number;
  currency: string;
  week_due_date?: Date;
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
  invoice_received_date?: Date;
  date_range_start?: Date;
  date_range_end?: Date;
  invoice_version?: string;
  invoice_version_notes?: string;
  vendor_name: string;
  amount: number;
  amount_original?: number;
  currency_original?: string;
  exchange_rate_to_usd?: number;
  currency: string;
  payment_terms: string;
  payment_term_split?: string;
  incoterm?: string;
  bank_charges?: number;
  shipping_charges?: number;
  customs_charges?: number;
  documentation_charges?: number;
  surcharges?: number;
  category: InvoiceCategory;
  order_type?: OrderType;
  brand?: string;
  season?: string;
  mpo_number?: string;
  po_number?: string;
  bill_to_name: string;
  bill_to_address: string;
  bill_to_entity?: MadisonEntity;
  is_handwritten?: boolean;
  is_priority?: boolean;
  priority_pay_date?: Date;
  payment_consolidation_note?: string;
  qb_memo?: string;
  qb_account_class?: string;
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
    is_digital?: boolean;
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
