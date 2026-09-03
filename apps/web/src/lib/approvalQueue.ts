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

export const orderedSignatures = (invoice: MockInvoice) => (invoice.signatures || [])
  .filter(signature => !signature.ocr_detected &&
    (!signature.invalidated_at || signature.approval_status === 'RECONFIRMATION_REQUIRED'))
  .sort((a, b) => APPROVAL_ROLE_ORDER.indexOf(a.signatory_role) - APPROVAL_ROLE_ORDER.indexOf(b.signatory_role));

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
