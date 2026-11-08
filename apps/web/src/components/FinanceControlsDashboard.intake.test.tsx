import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'ACCOUNTING_ASSOCIATE' } }) }));
vi.mock('../lib/api', () => ({
  default: { get: vi.fn(async (url: string) => ({ data: url.includes('email-intake-monitor')
    ? { events: [], failures_24h: 0, review_records: [{ id: 'review-1', file_name: 'Customs statement.pdf',
      document_type: 'STATEMENT', reason: 'Not eligible for invoice creation', status: 'OPEN', created_at: '2026-11-03T00:00:00Z' }] }
    : [] })) }, invoiceApi: {},
}));

import FinanceControlsDashboard from './FinanceControlsDashboard';

describe('intake review visibility', () => {
  it('displays retained document type and rejection reason separately from invoices', async () => {
    render(<FinanceControlsDashboard />);
    expect(await screen.findByText('Customs statement.pdf')).toBeInTheDocument();
    expect(screen.getByText('Detected type: STATEMENT')).toBeInTheDocument();
    expect(screen.getByText('Not eligible for invoice creation')).toBeInTheDocument();
    expect(screen.getByText('Document / Intake Review')).toBeInTheDocument();
  });
});
