import { MockInvoice } from './mockData';
import { isWithinRoleThreshold } from './roleAccess';

// The order signatures are collected in the workflow.
export const APPROVAL_ROLE_ORDER = [
  'COORDINATOR', 'PURCHASING_MANAGER',
  'SR_MANAGER_GLOBAL_PRODUCTION', 'PRESIDENT',
  'ACCOUNTING_REVIEWER',
];

export const mapUserRoleToSignatoryRoles = (role: string): string[] => {
  const mapping: Record<string, string[]> = {
    'PURCHASING_COORDINATOR': ['COORDINATOR'],
    'PURCHASING_MANAGER': ['PURCHASING_MANAGER'],
    'PLANNING_MANAGER': ['MLO_PLANNING_MANAGER'],
    'MLO_PLANNING_MANAGER': ['MLO_PLANNING_MANAGER'],
    'MLO_ACCOUNT_HOLDER': ['MLO_ACCOUNT_HOLDER', 'MLO_PLANNING_MANAGER'],
    'SR_MANAGER_GLOBAL_PRODUCTION': ['SR_MANAGER_GLOBAL_PRODUCTION'],
    'MS_POLLY': ['MS_POLLY'],
    'ACCOUNTING_ASSOCIATE': ['ACCOUNTING_REVIEWER'],
    'ACCOUNTING_SUPERVISOR': ['ACCOUNTING_REVIEWER'],
    'PRESIDENT': ['PRESIDENT', 'ACCOUNTING_REVIEWER'],
    'SUPERADMIN': [],
  };
  return mapping[role] || [];
};

// API payloads normally expose current_approver_role (for example,
// COORDINATOR), while some legacy/summary payloads expose the pending status
// (for example, PENDING_COORDINATOR). Normalize both forms before matching a
// returned signature so the invoice still lands with the exact coordinator
// who originally approved it.
const PENDING_STATUS_TO_SIGNATORY_ROLE: Record<string, string> = {
  PENDING_COORDINATOR: 'COORDINATOR',
  PENDING_MANAGER: 'PURCHASING_MANAGER',
  PENDING_MLO_ACCOUNT_HOLDER: 'MLO_ACCOUNT_HOLDER',
  PENDING_MLO_PLANNING_MANAGER: 'MLO_PLANNING_MANAGER',
  PENDING_SR_MANAGER: 'SR_MANAGER_GLOBAL_PRODUCTION',
  PENDING_POLLY: 'MS_POLLY',
  PENDING_PRESIDENT: 'PRESIDENT',
  PENDING_ACCOUNTING: 'ACCOUNTING_REVIEWER',
};

const normalizeCurrentStage = (stage?: string): string | undefined => {
  if (!stage) return undefined;
  return PENDING_STATUS_TO_SIGNATORY_ROLE[stage] || stage;
};

const coordinatorApprovedAfterLatestReturn = (invoice: MockInvoice): boolean => {
  const latestReturnAt = (invoice.audit_logs || [])
    .filter(log => ['RETURNED_FOR_CORRECTION', 'REJECTED'].includes(String(log.action || '').toUpperCase()))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]?.created_at;
  const returnTime = new Date(latestReturnAt || 0).getTime();
  return (invoice.signatures || []).some(sig =>
    sig.signatory_role === 'COORDINATOR' && !!sig.signed_at &&
    (!returnTime || new Date(sig.signed_at).getTime() > returnTime)
  );
};

const hasReturnHistory = (invoice: MockInvoice): boolean =>
  (invoice.audit_logs || []).some(log => ['RETURNED_FOR_CORRECTION', 'REJECTED'].includes(String(log.action || '').toUpperCase()));

export const orderedSignatures = (invoice: MockInvoice) => (invoice.signatures || [])
  .filter(signature => !signature.ocr_detected &&
    (!signature.invalidated_at || signature.approval_status === 'RECONFIRMATION_REQUIRED'))
  .sort((a, b) => APPROVAL_ROLE_ORDER.indexOf(a.signatory_role) - APPROVAL_ROLE_ORDER.indexOf(b.signatory_role));

/**
 * True when a workflow signature is an active return/re-open assigned to the
 * current user. OCR signatures are source evidence only and must never appear
 * in the returned queue.
 */
export function isReturnedSignatureForUser(
  sig: any,
  currentStage: string | undefined,
  user: { id?: string; name?: string } | null,
): boolean {
  if (!sig || sig.ocr_detected || sig.signed_at || sig.approval_status !== 'RECONFIRMATION_REQUIRED') return false;
  const normalizedStage = normalizeCurrentStage(currentStage);
  if (normalizedStage && sig.signatory_role !== normalizedStage) return false;
  if (sig.signatory_user_id) return Boolean(user?.id && sig.signatory_user_id === user.id);
  return Boolean(sig.signatory_name && user?.name &&
    sig.signatory_name.trim().toLowerCase() === user.name.trim().toLowerCase());
}

export interface ReturnedInvoiceDetails {
  invoice: MockInvoice;
  reason: string;
  returnedAt?: string;
  returnedBy?: string;
}

/**
 * Return the latest reason recorded for a returned invoice.
 *
 * The current stage is deliberately part of the match. A manager-returned
 * invoice has reconfirmation signatures for both purchasing steps, but it is
 * visible only to the active stage owner: first the coordinator, then (after
 * the coordinator approves) the purchasing manager.
 */
export function getReturnedInvoiceDetails(
  invoice: MockInvoice,
  user: { id?: string; name?: string; role?: string } | null,
): ReturnedInvoiceDetails | null {
  const returnLog = (invoice.audit_logs || [])
    .filter(log => ['RETURNED_FOR_CORRECTION', 'REJECTED'].includes(String(log.action || '').toUpperCase()))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];

  // A manager must not see an accounting-returned invoice until the
  // coordinator has completed the correction pass. Legacy records may still
  // say PENDING_MANAGER while the coordinator signature is only the original
  // signed approval, so require a fresh coordinator signature after the return.
  if (user?.role === 'PURCHASING_MANAGER' && String(invoice.status) === 'PENDING_MANAGER' && hasReturnHistory(invoice)) {
    if (!coordinatorApprovedAfterLatestReturn(invoice)) return null;
  }

  const returnedSignature = (invoice.signatures || [])
    .filter(sig => isReturnedSignatureForUser(sig, invoice.current_stage, user))
    .sort((a, b) => new Date(b.invalidated_at || 0).getTime() - new Date(a.invalidated_at || 0).getTime())[0];
  if (!returnedSignature) return null;

  const note = String(returnLog?.note || '');
  const reasonFromAudit = note.match(/reason:\s*(.+)$/i)?.[1]?.trim();
  // Audit notes contain the clean user-entered reason after "Reason:";
  // signature invalidation text may include a technical prefix, so prefer
  // the audit value when both are available.
  const reason = String(reasonFromAudit || returnedSignature.invalidation_reason || '').trim() || 'No return reason was recorded.';

  return {
    invoice,
    reason,
    returnedAt: returnLog?.created_at || returnedSignature.invalidated_at,
    returnedBy: returnLog?.performed_by,
  };
}

/** Returned invoices assigned to this user, newest return first. */
export function getReturnedInvoicesForUser(
  invoices: MockInvoice[],
  user: { role: string; name?: string; id?: string } | null,
): ReturnedInvoiceDetails[] {
  return invoices
    .map(invoice => getReturnedInvoiceDetails(invoice, user))
    .filter((entry): entry is ReturnedInvoiceDetails => entry !== null)
    .sort((a, b) => new Date(b.returnedAt || 0).getTime() - new Date(a.returnedAt || 0).getTime());
}

/** The timestamp when the coordinator endorsed the invoice to the next stage. */
export const getCoordinatorSubmissionDate = (invoice: MockInvoice): string | undefined =>
  orderedSignatures(invoice).find(signature =>
    signature.signatory_role === 'COORDINATOR' && !!signature.signed_at
  )?.signed_at;

/**
 * The invoices currently waiting on THIS user's approval — the exact same set
 * the Approval Inbox page renders, so the sidebar badge always matches the page.
 */
export function getPendingApprovalsForUser(invoices: MockInvoice[], user: { role: string; name?: string; id?: string } | null) {
  return invoices.filter(invoice => {
    if (orderedSignatures(invoice).length === 0) return false;
    // Exclude invoices not in an active approval workflow
    const status = String(invoice.status || '');
    if (!status.startsWith('PENDING_') || status === 'PENDING_ACCOUNTING') return false;
    // Exclude invoices below the user's tier threshold
    if (user && !isWithinRoleThreshold(user.role, Number(invoice.total_amount))) return false;
    // Find the first unsigned signature (sequential enforcement — signatures are in route order)
    const firstPending = orderedSignatures(invoice).find(s => !s.signed_at);
    if (!firstPending) return false;
    if (user?.role === 'PURCHASING_MANAGER' && String(invoice.status) === 'PENDING_MANAGER' &&
      hasReturnHistory(invoice) && !coordinatorApprovedAfterLatestReturn(invoice)) {
      return false;
    }
    if (firstPending.approval_status === 'RECONFIRMATION_REQUIRED') {
      // Returned invoices belong to the exact user who signed before the return.
      // Match by user id; legacy records without one fall back to name matching.
      const isMine = firstPending.signatory_user_id
        ? user?.id != null && firstPending.signatory_user_id === user.id
        : Boolean(firstPending.signatory_name && user?.name &&
            firstPending.signatory_name.trim().toLowerCase() === user.name.trim().toLowerCase());
      if (!isMine) return false;
    }
    const userSignatoryRoles = user ? mapUserRoleToSignatoryRoles(user.role) : [];
    return userSignatoryRoles.length > 0 ? userSignatoryRoles.includes(firstPending.signatory_role) : false;
  }).sort((a, b) => {
    const receivedA = new Date(a.invoice_received_date || a.created_at || a.invoice_date || 0).getTime();
    const receivedB = new Date(b.invoice_received_date || b.created_at || b.invoice_date || 0).getTime();
    return receivedA - receivedB || String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Invoices this user already approved (their own signature is signed), newest
 * first — powers the "My Approved Invoices" bar under the queue.
 */
export function getApprovedByUser(invoices: MockInvoice[], user: { role: string; name?: string; id?: string } | null) {
  if (!user) return [];
  return invoices
    .map(invoice => {
      const mySig = (invoice.signatures || []).find(sig =>
        sig.signatory_role === mapUserRoleToSignatoryRoles(user.role)[0] &&
        !!sig.signed_at &&
        (
          (sig.signatory_user_id && user.id && sig.signatory_user_id === user.id) ||
          (!sig.signatory_user_id && !!sig.signatory_name && user.name &&
            sig.signatory_name.trim().toLowerCase() === user.name.trim().toLowerCase())
        )
      );
      return mySig ? { invoice, signedAt: mySig.signed_at as string } : null;
    })
    .filter((entry): entry is { invoice: MockInvoice; signedAt: string } => entry !== null)
    .sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime());
}
