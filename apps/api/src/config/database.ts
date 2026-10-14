import { PrismaClient } from '@prisma/client';
import { validateWorkflowTransition } from '@ap-invoice/shared';

const DB_ENABLED = process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0;

let realPrisma: PrismaClient | null = null;

function canonicalWorkflowStatus(
  status: unknown,
  duplicateReviewStatus?: unknown,
  invoiceType?: unknown,
  sourceDocumentType?: unknown,
  documentClassification?: unknown,
): string {
  if (String(duplicateReviewStatus || '').toUpperCase() === 'PENDING') return 'DUPLICATE_REVIEW';
  if (['CORRECTED_REVISED', 'REPLACEMENT'].includes(String(duplicateReviewStatus || '').toUpperCase())) return 'REVISION_REVIEW';
  const classificationType = documentClassification && typeof documentClassification === 'object'
    ? (documentClassification as any).document_type
    : documentClassification;
  const documentType = String(classificationType || sourceDocumentType || invoiceType || '').toUpperCase();
  if (['PROFORMA', 'PROFORMA_INVOICE', 'PRO_FORMA'].includes(documentType)) return 'PROFORMA_REVIEW';
  if (['DEBIT_NOTE', 'CREDIT_NOTE', 'STATEMENT', 'PACKING_LIST', 'AIRWAY_BILL', 'DELIVERY_RECEIPT', 'PURCHASE_ORDER', 'UNKNOWN'].includes(documentType)) return 'NON_PAYABLE_REVIEW';
  switch (String(status || '').toUpperCase()) {
    case 'OCR_PROCESSING': return 'OCR_PROCESSING';
    case 'VALIDATION_PENDING':
    case 'EXCEPTION_FLAGGED': return 'REVIEW_REQUIRED';
    case 'PENDING_COORDINATOR':
    case 'PENDING_MANAGER':
    case 'PENDING_MLO_ACCOUNT_HOLDER':
    case 'PENDING_MLO_PLANNING_MANAGER':
    case 'PENDING_SR_MANAGER':
    case 'PENDING_POLLY':
    case 'PENDING_PRESIDENT': return 'PURCHASING_REVIEW';
    case 'PENDING_ACCOUNTING': return 'ACCOUNTING_REVIEW';
    case 'APPROVED': return 'APPROVED';
    case 'POSTED_TO_QB': return 'POSTED_TO_QB';
    case 'PAYMENT_SCHEDULED':
    case 'PAYMENT_CONFIRMATION_SENT': return 'PAYMENT_SCHEDULED';
    case 'PAID': return 'PAID';
    case 'ON_HOLD': return 'ON_HOLD';
    case 'REJECTED': return 'REJECTED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'RECEIVED';
  }
}

if (DB_ENABLED) {
  realPrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
  realPrisma.$use(async (params, next) => {
    if (params.model === 'Invoice' && ['create', 'update', 'updateMany', 'upsert'].includes(params.action) && params.args?.data) {
      const data = params.args.data as Record<string, any>;
      if (params.action === 'create' && data.invoice_number && data.normalized_invoice_number === undefined) {
        const compact = String(data.invoice_number).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        data.normalized_invoice_number = compact
          .replace(/(?:REV(?:ISION)?|CORR(?:ECTED)?|REPLACEMENT)$/i, '')
          .replace(/^0+(?=\d)/, '')
          .replace(/^([A-Z]+)0+(?=\d)/, '$1');
      }
      if (params.action === 'create' && data.retention_until === undefined) {
        const base = data.created_at ? new Date(data.created_at) : new Date();
        base.setUTCFullYear(base.getUTCFullYear() + 7);
        data.retention_until = base;
      }
      if (params.action === 'create' && data.source_received_at === undefined && data.invoice_received_date) {
        data.source_received_at = data.invoice_received_date;
      }
      if (data.workflow_status === undefined && data.status !== undefined) {
        data.workflow_status = canonicalWorkflowStatus(
          data.status,
          data.duplicate_review_status,
          data.invoice_type,
          data.source_document_type,
          data.document_classification,
        );
      }
      const requestedWorkflow = data.workflow_status;
      if (requestedWorkflow !== undefined && ['update', 'updateMany', 'upsert'].includes(params.action)) {
        const candidates: Array<{ workflow_status?: string | null; status?: string | null; duplicate_review_status?: string | null }> = [];
        if (params.action === 'update' || params.action === 'upsert') {
          const where = params.args.where;
          if (where?.id || where?.ap_record_id || where?.invoice_number) {
            const current = await realPrisma!.invoice.findFirst({ where, select: { workflow_status: true, status: true, duplicate_review_status: true } });
            if (current) candidates.push(current);
          }
        } else if (params.action === 'updateMany') {
          const current = await realPrisma!.invoice.findMany({ where: params.args.where || {}, take: 2000, select: { workflow_status: true, status: true, duplicate_review_status: true } });
          candidates.push(...current);
        }
        for (const current of candidates) {
          const transition = validateWorkflowTransition(current.workflow_status || canonicalWorkflowStatus(current.status, current.duplicate_review_status), requestedWorkflow, { duplicateReviewStatus: data.duplicate_review_status ?? current.duplicate_review_status });
          if (!transition.ok) {
            const error: any = new Error(transition.reason || 'Invalid workflow transition');
            error.statusCode = 409;
            error.code = 'WORKFLOW_TRANSITION_BLOCKED';
            throw error;
          }
        }
      }
    }
    return next(params);
  });
  console.log('[Database] DB_ENABLED mode - Prisma initialized');
} else {
  console.log('[Database] DB_DISABLED mode - Prisma not initialized (vendor system offline)');
}

// Proxy that exposes a non-null PrismaClient type but throws if DB is disabled
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!realPrisma) {
      throw new Error('Database not available');
    }
    return (realPrisma as any)[prop];
  },
});

export default prisma;

export const getPrisma = () => realPrisma;

export const isDbEnabled = () => DB_ENABLED;

export const isDbConnected = async () => {
  if (!DB_ENABLED || !realPrisma) return false;
  try {
    await realPrisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

export const connectDatabase = async () => {
  if (!DB_ENABLED || !realPrisma) {
    console.log('[Database] DB disabled - skipping connection');
    return;
  }

  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('Running without database — some endpoints will not work');
    }
  }
};

export const disconnectDatabase = async () => {
  if (realPrisma) {
    await realPrisma.$disconnect();
  }
};
