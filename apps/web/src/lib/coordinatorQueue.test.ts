import { describe, expect, it } from 'vitest';
import { isCoordinatorQueueStatus, displayInvoiceStatus } from './coordinatorQueue';

describe('coordinator queue routing', () => {
  it('includes newly captured RECEIVED invoices while validation is running', () => {
    expect(isCoordinatorQueueStatus('RECEIVED')).toBe(true);
    expect(displayInvoiceStatus('RECEIVED')).toBe('Pending Coordinator');
  });

  it('keeps exception and validation states in the same coordinator hand-off queue', () => {
    expect(isCoordinatorQueueStatus('VALIDATION_PENDING')).toBe(true);
    expect(isCoordinatorQueueStatus('EXCEPTION_FLAGGED')).toBe(true);
    expect(isCoordinatorQueueStatus('PENDING_COORDINATOR')).toBe(true);
  });

  it('does not expose downstream approval stages as coordinator work', () => {
    expect(isCoordinatorQueueStatus('PENDING_MANAGER')).toBe(false);
    expect(isCoordinatorQueueStatus('PENDING_ACCOUNTING')).toBe(false);
    expect(isCoordinatorQueueStatus('APPROVED')).toBe(false);
  });
});
