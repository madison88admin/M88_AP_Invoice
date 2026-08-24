import crypto from 'crypto';
import prisma from '../config/database';
import { bankAccountFingerprint, maskBankAccount } from '../utils/sensitiveData';
import { AppError } from '../middleware/errorHandler';

type Finding = { invoice_id?: string; payment_id?: string; code: string; severity: 'WARNING' | 'HIGH' | 'CRITICAL'; detail: string };
const fingerprint = (finding: Finding) => crypto.createHash('sha256').update(JSON.stringify(finding)).digest('hex');

async function persistRun(runType: string, findings: Finding[], initiatedBy?: string) {
  return prisma.financeControlRun.create({ data: {
    run_type: runType, status: 'COMPLETED', completed_at: new Date(), initiated_by: initiatedBy,
    summary: { total: findings.length, critical: findings.filter(f => f.severity === 'CRITICAL').length, high: findings.filter(f => f.severity === 'HIGH').length },
    findings: { create: findings.map(f => ({ ...f, fingerprint: fingerprint(f) })) },
  }, include: { findings: true } });
}

export async function updateFindingWorkflow(id: string, action: string, actorId: string, input: { assignedTo?: string; note?: string; escalateTo?: string }) {
  const finding = await prisma.financeControlFinding.findUnique({ where: { id } });
  if (!finding) throw new Error('Finance control finding not found');
  const now = new Date();
  const data: any = { last_seen_at: now };
  switch (action.toUpperCase()) {
    case 'ASSIGN':
      if (!input.assignedTo) throw new Error('assignedTo is required');
      Object.assign(data, { assigned_to: input.assignedTo, status: 'ASSIGNED' });
      break;
    case 'ACKNOWLEDGE':
      Object.assign(data, { acknowledged_by: actorId, acknowledged_at: now, status: 'ACKNOWLEDGED' });
      break;
    case 'RESOLVE':
      if (!input.note?.trim()) throw new Error('Resolution note is required');
      if (finding.code === 'NEXTGEN_SNAPSHOT_MISSING') {
        if (!finding.invoice_id) throw new AppError('This finding has no invoice reference and cannot be resolved.', 409);
        const invoice = await prisma.invoice.findUnique({ where: { id: finding.invoice_id }, select: { po_validation: true } });
        if (!invoice?.po_validation) {
          throw new AppError('Run the NextGen validation and retain its snapshot before resolving this finding.', 409);
        }
      }
      Object.assign(data, { resolved_by: actorId, resolved_at: now, resolution_note: input.note.trim(), status: 'RESOLVED' });
      break;
    case 'REOPEN':
      Object.assign(data, { reopened_by: actorId, reopened_at: now, resolved_by: null, resolved_at: null, status: 'OPEN' });
      break;
    case 'ESCALATE':
      if (!input.escalateTo) throw new Error('escalateTo is required');
      Object.assign(data, { escalated_to: input.escalateTo, escalated_at: now, status: 'ESCALATED' });
      break;
    default: throw new Error('Unsupported finding action');
  }
  return prisma.financeControlFinding.update({ where: { id }, data });
}

/** Deterministic anomaly scan. Findings are alerts, never accusations or AI decisions. */
export async function runAnomalyScan(initiatedBy?: string) {
  const [vendors, invoices] = await Promise.all([
    prisma.vendor.findMany({ where: { is_active: true } }),
    prisma.invoice.findMany({ include: { payments: true, signatures: true } }),
  ]);
  const findings: Finding[] = [];
  const accounts = new Map<string, any[]>();
  for (const vendor of vendors) {
    const key = bankAccountFingerprint(vendor.account_number);
    if (!key) continue;
    accounts.set(key, [...(accounts.get(key) || []), vendor]);
  }
  for (const matches of accounts.values()) if (matches.length > 1) findings.push({
    code: 'BANK_ACCOUNT_REUSED', severity: 'CRITICAL',
    detail: `Masked account ${maskBankAccount(matches[0].account_number)} is assigned to multiple active vendors: ${matches.map(v => v.name).join(', ')}.`,
  });
  for (const invoice of invoices as any[]) {
    const activePayments = invoice.payments.filter((p: any) => !['CANCELLED', 'VOIDED'].includes(p.status));
    if (activePayments.length > 1) findings.push({ invoice_id: invoice.id, code: 'DUPLICATE_ACTIVE_PAYMENT', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} has ${activePayments.length} active payment records.` });
    if (invoice.qb_posted_at && !activePayments.length) findings.push({ invoice_id: invoice.id, code: 'POSTED_WITHOUT_PAYMENT', severity: 'WARNING', detail: `Invoice ${invoice.invoice_number} is posted but has no active payment.` });
    if (activePayments.some((p: any) => p.paid_at) && !invoice.qb_posted_at) findings.push({ invoice_id: invoice.id, code: 'PAID_NOT_POSTED', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} is paid but has no posting timestamp.` });
    if (activePayments.some((p: any) => p.invoice_revision_snapshot != null && p.invoice_revision_snapshot !== invoice.revision)) findings.push({ invoice_id: invoice.id, code: 'CHANGED_AFTER_PAYMENT_PREP', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} revision changed after payment preparation.` });
  }
  return persistRun('ANOMALY', findings, initiatedBy);
}

/** Four-way AP ↔ NextGen snapshot ↔ QB posting ↔ payment confirmation reconciliation. */
export async function runFourWayReconciliation(initiatedBy?: string) {
  const invoices = await prisma.invoice.findMany({ include: { vendor: true, payments: true, payment_confirmations: true, signatures: true } });
  const findings: Finding[] = [];
  for (const invoice of invoices as any[]) {
    const po = invoice.po_validation as any;
    const active = invoice.payments.filter((p: any) => !['CANCELLED', 'VOIDED'].includes(p.status));
    if (['APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'].includes(invoice.status) && !po) {
      const approvers = (invoice.signatures || [])
        .filter((signature: any) => signature.signed_at && signature.approval_status !== 'REJECTED')
        .map((signature: any) => `${signature.signatory_name} (${String(signature.signatory_role).replace(/_/g, ' ')})`);
      const approvalNote = approvers.length ? ` Approved by: ${approvers.join(', ')}.` : ' No signed approver is recorded.';
      findings.push({ invoice_id: invoice.id, code: 'NEXTGEN_SNAPSHOT_MISSING', severity: 'HIGH', detail: `Invoice ${invoice.invoice_number} has no retained NextGen validation snapshot.${approvalNote}` });
    }
    if (invoice.status === 'PAID' && !invoice.qb_posted_at) findings.push({ invoice_id: invoice.id, code: 'PAID_NOT_POSTED', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} is paid but not posted.` });
    if (invoice.status === 'PAID' && invoice.payment_confirmations.length === 0) findings.push({ invoice_id: invoice.id, code: 'PAYMENT_CONFIRMATION_MISSING', severity: 'HIGH', detail: `Invoice ${invoice.invoice_number} is paid without confirmation.` });
    for (const payment of active) {
      if (Number(payment.amount) !== Number(invoice.total_amount) || payment.currency !== invoice.currency) findings.push({ invoice_id: invoice.id, payment_id: payment.id, code: 'PAYMENT_INVOICE_MISMATCH', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} payment amount/currency does not match AP.` });
    }
  }
  return persistRun('FOUR_WAY_RECONCILIATION', findings, initiatedBy);
}

export async function listFinanceControlRuns(runType?: string) {
  return prisma.financeControlRun.findMany({ where: runType ? { run_type: runType } : undefined, include: { findings: true }, orderBy: { started_at: 'desc' }, take: 30 });
}
