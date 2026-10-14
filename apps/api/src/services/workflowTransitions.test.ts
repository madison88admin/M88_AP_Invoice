/// <reference types="vitest/globals" />
import { validateWorkflowTransition } from '@ap-invoice/shared';

describe('workflow transition controls', () => {
  it('blocks duplicate review from payment', () => {
    expect(validateWorkflowTransition('DUPLICATE_REVIEW', 'APPROVED').ok).toBe(false);
  });

  it('blocks non-payable review from payment', () => {
    expect(validateWorkflowTransition('NON_PAYABLE_REVIEW', 'POSTED_TO_QB').ok).toBe(false);
  });

  it('keeps terminal records immutable', () => {
    expect(validateWorkflowTransition('PAID', 'REVIEW_REQUIRED').ok).toBe(false);
  });

  it('allows normal review to purchasing progression', () => {
    expect(validateWorkflowTransition('REVIEW_REQUIRED', 'PURCHASING_REVIEW').ok).toBe(true);
  });
});
