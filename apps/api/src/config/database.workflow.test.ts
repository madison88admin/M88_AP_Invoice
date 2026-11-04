import { describe, expect, it } from 'vitest';
import { validateWorkflowTransition } from '@ap-invoice/shared';
import { canonicalWorkflowStatus } from './database';

describe('paid notification lifecycle projection', () => {
  it('keeps confirmation-sent invoices Paid instead of attempting to reopen payment scheduling', () => {
    const next = canonicalWorkflowStatus('PAYMENT_CONFIRMATION_SENT');
    expect(next).toBe('PAID');
    expect(validateWorkflowTransition('PAID', next)).toEqual({ ok: true });
    expect(validateWorkflowTransition('PAID', canonicalWorkflowStatus('PAYMENT_SCHEDULED')).ok).toBe(false);
  });
});
