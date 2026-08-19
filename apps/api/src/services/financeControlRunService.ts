import crypto from 'crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { bankAccountFingerprint, maskBankAccount } from '../utils/sensitiveData';

type Finding = { invoice_id?: string; payment_id?: string; code: string; severity: 'WARNING' | 'HIGH' | 'CRITICAL'; detail: string };
const fingerprint = (finding: Finding) => crypto.createHash('sha256').update(JSON.stringify(finding)).digest('hex');

async function persistRun(runType: string, findings: Finding[], initiatedBy?: string) {
  return prisma.financeControlRun.create({ data: {
    run_type: runType, status: 'COMPLETED', completed_at: new Date(), initiated_by: initiatedBy,
    summary: { total: findings.length, critical: findings.filter(f => f.severity === 'CRITICAL').length, high: findings.filter(f => f.severity === 'HIGH').length },
    findings: { create: findings.map(f => ({ ...f, fingerprint: fingerprint(f) })) },
  }, include: { findings: true } });
}

const summarize = (findings: Finding[]) => ({
  total: findings.length,
  critical: findings.filter(f => f.severity === 'CRITICAL').length,
  high: findings.filter(f => f.severity === 'HIGH').length,
});

async function finalizeRun(runId: string, findings: Finding[]) {
  return prisma.financeControlRun.update({
    where: { id: runId },
    data: {
      status: 'COMPLETED',
      completed_at: new Date(),
      summary: summarize(findings),
      findings: { create: findings.map(f => ({ ...f, fingerprint: fingerprint(f) })) },
    },
    include: { findings: true },
  });
}

const SCAN_COLLECTORS: Record<string, () => Promise<Finding[]>> = {
  ANOMALY: collectAnomalyFindings,
  FOUR_WAY_RECONCILIATION: collectReconciliationFindings,
};

/**
 * Start a control scan in the background and return the RUNNING row immediately.
 * The scans walk every invoice, so running them inside the HTTP request left the
 * browser waiting on a full-table pass (and timing out on large databases).
 * Callers poll the run list for completion.
 */
export async function startFinanceControlRun(runType: string, initiatedBy?: string) {
  const collect = SCAN_COLLECTORS[runType];
  if (!collect) throw new Error(`Unknown finance control run type: ${runType}`);

  // A run abandoned by a crashed process must not block manual runs forever.
  const staleBefore = new Date(Date.now() - 30 * 60 * 1000);
  const inFlight = await prisma.financeControlRun.findFirst({
    where: { run_type: runType, status: 'RUNNING', started_at: { gte: staleBefore } },
  });
  if (inFlight) return { ...inFlight, findings: [], already_running: true };
  await prisma.financeControlRun.updateMany({
    where: { run_type: runType, status: 'RUNNING', started_at: { lt: staleBefore } },
    data: { status: 'FAILED', completed_at: new Date(), error: 'Run abandoned (process restarted or timed out)' },
  });

  const placeholder = await prisma.financeControlRun.create({
    data: { run_type: runType, status: 'RUNNING', initiated_by: initiatedBy },
  });

  void (async () => {
    try {
      await finalizeRun(placeholder.id, await collect());
    } catch (error) {
      logger.error(`[Finance Controls] ${runType} run failed:`, error);
      await prisma.financeControlRun.update({
        where: { id: placeholder.id },
        data: { status: 'FAILED', completed_at: new Date(), error: error instanceof Error ? error.message : String(error) },
      }).catch(() => undefined);
    }
  })();

  return { ...placeholder, findings: [], already_running: false };
}

/** Timestamp of the most recent completed run, used for restart catch-up. */
export async function getLastFinanceControlRunAt(): Promise<Date | null> {
  const run = await prisma.financeControlRun.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { started_at: 'desc' },
    select: { started_at: true },
  });
  return run?.started_at ?? null;
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
  return persistRun('ANOMALY', await collectAnomalyFindings(), initiatedBy);
}

async function collectAnomalyFindings(): Promise<Finding[]> {
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
  return findings;
}

/** Four-way AP ↔ NextGen snapshot ↔ QB posting ↔ payment confirmation reconciliation. */
export async function runFourWayReconciliation(initiatedBy?: string) {
  return persistRun('FOUR_WAY_RECONCILIATION', await collectReconciliationFindings(), initiatedBy);
}

async function collectReconciliationFindings(): Promise<Finding[]> {
  const invoices = await prisma.invoice.findMany({ include: { vendor: true, payments: true, payment_confirmations: true } });
  const findings: Finding[] = [];
  for (const invoice of invoices as any[]) {
    const po = invoice.po_validation as any;
    const active = invoice.payments.filter((p: any) => !['CANCELLED', 'VOIDED'].includes(p.status));
    if (['APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'].includes(invoice.status) && !po) findings.push({ invoice_id: invoice.id, code: 'NEXTGEN_SNAPSHOT_MISSING', severity: 'HIGH', detail: `Invoice ${invoice.invoice_number} has no retained NextGen validation snapshot.` });
    if (invoice.status === 'PAID' && !invoice.qb_posted_at) findings.push({ invoice_id: invoice.id, code: 'PAID_NOT_POSTED', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} is paid but not posted.` });
    if (invoice.status === 'PAID' && invoice.payment_confirmations.length === 0) findings.push({ invoice_id: invoice.id, code: 'PAYMENT_CONFIRMATION_MISSING', severity: 'HIGH', detail: `Invoice ${invoice.invoice_number} is paid without confirmation.` });
    for (const payment of active) {
      if (Number(payment.amount) !== Number(invoice.total_amount) || payment.currency !== invoice.currency) findings.push({ invoice_id: invoice.id, payment_id: payment.id, code: 'PAYMENT_INVOICE_MISMATCH', severity: 'CRITICAL', detail: `Invoice ${invoice.invoice_number} payment amount/currency does not match AP.` });
    }
  }
  return findings;
}

export async function listFinanceControlRuns(runType?: string) {
  return prisma.financeControlRun.findMany({ where: runType ? { run_type: runType } : undefined, include: { findings: true }, orderBy: { started_at: 'desc' }, take: 30 });
}
