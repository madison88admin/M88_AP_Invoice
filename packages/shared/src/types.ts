// ─── ENUMS (aligned with BRD v5.0 + Prisma schema) ───

export enum InvoiceType {
  INVOICE = 'INVOICE',
  PROFORMA = 'PROFORMA',
  COMMERCIAL = 'COMMERCIAL',
  SALES = 'SALES',
  STATEMENT = 'STATEMENT',
  PREPAID = 'PREPAID',
  PROTO_SAMPLE = 'PROTO_SAMPLE',
}

export enum InvoiceTemplateType {
  PRO_FORMA = 'PRO_FORMA',
  INVOICE = 'INVOICE',
  COMMERCIAL_INVOICE = 'COMMERCIAL_INVOICE',
  SALES_INVOICE = 'SALES_INVOICE',
  PROTO_SAMPLE_INVOICE = 'PROTO_SAMPLE_INVOICE',
  PREPAID_INVOICE = 'PREPAID_INVOICE',
  NO_DATA = 'NO_DATA',
}

export enum InvoiceCategory {
  TRIMS = 'TRIMS',
  YARN = 'YARN',
  SAMPLE_CHARGES = 'SAMPLE_CHARGES',
  SHIPPING_FREIGHT = 'SHIPPING_FREIGHT',
  LAB_TESTING = 'LAB_TESTING',
  FACTORY = 'FACTORY',
  FACTORY_AUDIT = 'FACTORY_AUDIT',
  PROFESSIONAL_FEE = 'PROFESSIONAL_FEE',
  SMS = 'SMS',
  CONSULTATION = 'CONSULTATION',
  OTHER = 'OTHER',
}

export enum OrderType {
  BULK = 'BULK',
  SMS = 'SMS',
  SAMPLE = 'SAMPLE',
}

export enum InvoiceStatus {
  RECEIVED = 'RECEIVED',
  OCR_PROCESSING = 'OCR_PROCESSING',
  VALIDATION_PENDING = 'VALIDATION_PENDING',
  EXCEPTION_FLAGGED = 'EXCEPTION_FLAGGED',
  PENDING_COORDINATOR = 'PENDING_COORDINATOR',
  PENDING_MANAGER = 'PENDING_MANAGER',
  PENDING_MLO_ACCOUNT_HOLDER = 'PENDING_MLO_ACCOUNT_HOLDER',
  PENDING_MLO_PLANNING_MANAGER = 'PENDING_MLO_PLANNING_MANAGER',
  PENDING_SR_MANAGER = 'PENDING_SR_MANAGER',
  PENDING_POLLY = 'PENDING_POLLY',
  PENDING_ACCOUNTING = 'PENDING_ACCOUNTING',
  APPROVED = 'APPROVED',
  POSTED_TO_QB = 'POSTED_TO_QB',
  PAYMENT_SCHEDULED = 'PAYMENT_SCHEDULED',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
  ON_HOLD = 'ON_HOLD',
}

export enum SignatoryRole {
  COORDINATOR = 'COORDINATOR',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  MLO_ACCOUNT_HOLDER = 'MLO_ACCOUNT_HOLDER',
  MLO_PLANNING_MANAGER = 'MLO_PLANNING_MANAGER',
  SR_MANAGER_GLOBAL_PRODUCTION = 'SR_MANAGER_GLOBAL_PRODUCTION',
  MS_POLLY = 'MS_POLLY',
  ACCOUNTING_REVIEWER = 'ACCOUNTING_REVIEWER',
}

export enum SignatureType {
  WET = 'WET',
  DIGITAL = 'DIGITAL',
  COMPUTER_GENERATED = 'COMPUTER_GENERATED',
}

export enum ExceptionReason {
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  VENDOR_NOT_FOUND = 'VENDOR_NOT_FOUND',
  DUPLICATE_INVOICE = 'DUPLICATE_INVOICE',
  MISSING_SIGNATURE = 'MISSING_SIGNATURE',
  MISSING_BANK_INFO = 'MISSING_BANK_INFO',
  BANK_DETAIL_MISMATCH = 'BANK_DETAIL_MISMATCH',
  OCR_LOW_CONFIDENCE = 'OCR_LOW_CONFIDENCE',
  LATE_SUBMISSION = 'LATE_SUBMISSION',
  HANDWRITTEN_DOCUMENT = 'HANDWRITTEN_DOCUMENT',
  MISSING_PO_REFERENCE = 'MISSING_PO_REFERENCE',
  MULTI_PO_CONSOLIDATED = 'MULTI_PO_CONSOLIDATED',
  MISSING_BRAND_TIER = 'MISSING_BRAND_TIER',
  VENDOR_THRESHOLD_EXCEEDED = 'VENDOR_THRESHOLD_EXCEEDED',
  BATCH_THRESHOLD_NOT_MET = 'BATCH_THRESHOLD_NOT_MET',
  PO_NOT_FOUND = 'PO_NOT_FOUND',
}

export enum ExceptionStatus {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  WAIVED = 'WAIVED',
}

export enum BillToEntity {
  MADISON_88_LTD = 'MADISON_88_LTD',
  MADISON_88_HK_LIMITED = 'MADISON_88_HK_LIMITED',
}

export enum InvoiceSource {
  EMAIL = 'EMAIL',
  MANUAL_UPLOAD = 'MANUAL_UPLOAD',
  PORTAL = 'PORTAL',
}

export enum PaymentBatchStatus {
  DRAFT = 'DRAFT',
  PENDING_CFO = 'PENDING_CFO',
  APPROVED = 'APPROVED',
  PROCESSED = 'PROCESSED',
  CANCELLED = 'CANCELLED',
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

export enum BrandTier {
  TOP_10 = 'TOP_10',
  OTHER = 'OTHER',
}

export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  ACCOUNTING_ASSOCIATE = 'ACCOUNTING_ASSOCIATE',
  ACCOUNTING_SUPERVISOR = 'ACCOUNTING_SUPERVISOR',
  PURCHASING_COORDINATOR = 'PURCHASING_COORDINATOR',
  PURCHASING_MANAGER = 'PURCHASING_MANAGER',
  MLO_ACCOUNT_HOLDER = 'MLO_ACCOUNT_HOLDER',
  PLANNING_MANAGER = 'PLANNING_MANAGER',
  SR_MANAGER_GLOBAL_PRODUCTION = 'SR_MANAGER_GLOBAL_PRODUCTION',
  MS_POLLY = 'MS_POLLY',
  CFO = 'CFO',
  PRESIDENT = 'PRESIDENT',
  IT_ADMIN = 'IT_ADMIN',
}

// ─── INTERFACES ───

export interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date?: Date;
  invoice_received_date?: Date;
  due_date?: Date;
  date_range_start?: Date;
  date_range_end?: Date;
  parent_invoice_id?: string;
  vendor_id?: string;
  vendor?: Vendor;
  vendor_name_raw: string;
  total_amount: number;
  subtotal?: number;
  currency: string;
  invoice_currency_original?: string;
  exchange_rate_to_usd?: number;
  payment_terms?: string;
  payment_penalty_rate?: number;
  incoterm?: string;
  bank_charges?: number;
  freight_charges?: number;
  additional_charges?: number;
  invoice_type: InvoiceType;
  invoice_template_type?: InvoiceTemplateType;
  category?: InvoiceCategory;
  order_type?: OrderType;
  brand?: string;
  brand_code?: string;
  season?: string;
  mpo_number?: string;
  customer_po_number?: string;
  bill_to_entity: BillToEntity;
  approval_tier?: number;
  current_approver_role?: string;
  priority_flag: boolean;
  priority_pay_date?: Date;
  is_urgent: boolean;
  is_duplicate: boolean;
  ocr_confidence_score?: number;
  is_handwritten: boolean;
  exception_reasons: ExceptionReason[];
  qb_memo?: string;
  qb_account_class?: string;
  qb_posted_at?: Date;
  sharepoint_folder_url?: string;
  sharepoint_filed_at?: Date;
  source: InvoiceSource;
  raw_file_url?: string;
  status: InvoiceStatus;
  signatures?: Signature[];
  audit_logs?: AuditLog[];
  exceptions?: Exception[];
  stage_timestamps?: StageTimestamp[];
  payments?: Payment[];
  created_at: Date;
  updated_at: Date;
}

export interface Vendor {
  id: string;
  name: string;
  name_aliases: string[];
  beneficiary_name?: string;
  supplier_location?: string;
  invoice_template_type: InvoiceTemplateType;
  bank_name?: string;
  bank_address?: string;
  account_number?: string;
  swift_code?: string;
  iban?: string;
  sort_code?: string;
  aba_routing_number?: string;
  intermediary_bank_name?: string;
  intermediary_bank_swift?: string;
  gstin_number?: string;
  bir_tin?: string;
  vat_number?: string;
  eori_number?: string;
  is_active: boolean;
  onboarded_by?: string;
  bank_verified_at?: Date;
  invoices?: Invoice[];
}

export interface Signature {
  id: string;
  invoice_id: string;
  signatory_name: string;
  signatory_role: SignatoryRole;
  signed_at?: Date;
  signature_type: SignatureType;
  created_at?: Date;
}

export interface AuditLog {
  id: string;
  invoice_id?: string;
  action: string;
  performed_by?: string;
  note?: string;
  created_at: Date;
}

export interface Exception {
  id: string;
  invoice_id: string;
  reason: ExceptionReason;
  detail?: string;
  status: ExceptionStatus;
  resolved_by?: string;
  resolution_notes?: string;
  resolved_at?: Date;
  created_at: Date;
}

export interface StageTimestamp {
  id: string;
  invoice_id: string;
  stage: InvoiceStatus;
  entered_at: Date;
  exited_at?: Date;
  sla_hours: number;
  is_breached: boolean;
}

export interface Payment {
  id: string;
  invoice_id: string;
  vendor_id?: string;
  amount: number;
  currency: string;
  payment_date: Date;
  status: string;
  batch_id?: string;
  paid_at?: Date;
  reference?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface PaymentBatch {
  id: string;
  batch_number: string;
  total_amount: number;
  payment_count: number;
  currency: string;
  status: PaymentBatchStatus;
  created_by?: string;
  processed_by?: string;
  processed_at?: Date;
  cancelled_by?: string;
  cancelled_at?: Date;
  cancellation_reason?: string;
  payments: Payment[];
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
  vendor_name: string;
  total_amount: number;
  subtotal?: number;
  currency: string;
  invoice_currency_original?: string;
  exchange_rate_to_usd?: number;
  payment_terms?: string;
  incoterm?: string;
  bank_charges?: number;
  freight_charges?: number;
  additional_charges?: number;
  invoice_type: InvoiceType;
  invoice_template_type?: InvoiceTemplateType;
  category?: InvoiceCategory;
  order_type?: OrderType;
  brand?: string;
  brand_code?: string;
  season?: string;
  mpo_number?: string;
  customer_po_number?: string;
  bill_to_entity?: BillToEntity;
  is_handwritten?: boolean;
  is_urgent?: boolean;
  priority_pay_date?: Date;
  ocr_confidence_score?: number;
  qb_memo?: string;
  qb_account_class?: string;
  bank_info: {
    bank_name: string;
    swift_code: string;
    account_number: string;
    bank_address?: string;
    iban?: string;
    sort_code?: string;
    aba_routing_number?: string;
    intermediary_bank_name?: string;
    intermediary_bank_swift?: string;
  };
  signatures: Array<{
    signatory_name: string;
    signed_at?: Date;
    signatory_role: SignatoryRole;
    signature_type: SignatureType;
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
