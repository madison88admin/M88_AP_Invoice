import { InvoiceStatus } from '@ap-invoice/shared';

/**
 * These are distinct internal processing states, but they represent one
 * user-facing hand-off: Purchasing Coordinator action is required.
 * Keeping the raw states preserves validation and audit behaviour while the
 * UI presents one consistent queue and label.
 */
export const COORDINATOR_QUEUE_STATUSES = new Set<string>([
  InvoiceStatus.VALIDATION_PENDING,
  InvoiceStatus.EXCEPTION_FLAGGED,
  InvoiceStatus.PENDING_COORDINATOR,
]);

export function isCoordinatorQueueStatus(status?: string | null): boolean {
  return COORDINATOR_QUEUE_STATUSES.has(String(status || ''));
}

export function displayInvoiceStatus(status?: string | null): string {
  return isCoordinatorQueueStatus(status) ? 'Pending Coordinator' : String(status || '').replace(/_/g, ' ');
}
