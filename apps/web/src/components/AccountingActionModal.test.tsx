import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AccountingActionModal } from './AccountingActionModal';

describe('Accounting action forms', () => {
  it('requires hold reason, evidence and review date before saving, without using browser prompts', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<AccountingActionModal action="hold" subject="QA-INV" owner="QA Associate" busy={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('QA Associate');
    const submit = screen.getByRole('button', { name: 'Place payment on hold' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: ' Awaiting supplier agreement ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Supporting evidence / document reference (required)'), { target: { value: 'EMAIL-QA-1' } });
    fireEvent.change(screen.getByLabelText('Expected response / review date (required)'), { target: { value: '2099-01-01' } });
    fireEvent.click(submit);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ reason: 'Awaiting supplier agreement', evidenceReference: 'EMAIL-QA-1', reviewDate: '2099-01-01' }));
  });

  it('cancels a return without submitting a decision', () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<AccountingActionModal action="return" subject="QA-BATCH" busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
  });
});
