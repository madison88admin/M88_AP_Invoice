import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Dashboard from './Dashboard';
import { AuthProvider } from '../contexts/AuthContext';
import { MockDataProvider } from '../contexts/MockDataContext';
import { ToastProvider } from '../contexts/ToastContext';

// Dashboard and every provider it sits inside pull data through the API module.
// Stub it so no network calls happen in jsdom and all lists resolve empty.
vi.mock('../lib/api', () => {
  const ok = () => Promise.resolve({ data: [] });
  // Any api namespace: every method resolves with an empty payload.
  const stub = () => new Proxy({}, { get: () => () => ok() });
  return {
    default: stub(),
    invoiceApi: stub(),
    vendorApi: stub(),
    paymentBatchApi: stub(),
    notificationApi: stub(),
    exceptionApi: stub(),
    aliasApi: stub(),
  };
});

// AuthProvider restores the session from localStorage — seed it the same way
// the login flow does (3-part token + JSON user payload).
const SESSION_KEY = 'auth_session';

function seedUser(role: string) {
  localStorage.setItem('auth_token', 'header.payload.signature');
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      id: 'u1',
      email: 'user@madison88.com',
      name: 'Test User',
      role,
      title: role.toLowerCase().replace(/_/g, ' '),
    })
  );
}

function renderDashboard() {
  return render(
    <AuthProvider>
      <MockDataProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/dashboard']}>
            <Dashboard />
          </MemoryRouter>
        </ToastProvider>
      </MockDataProvider>
    </AuthProvider>
  );
}

// Mirrors main.tsx + App.tsx wiring (QueryClient + routes) so KPI clicks
// actually navigate between the two Dashboard modes.
function renderDashboardWithRoutes(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MockDataProvider>
          <ToastProvider>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/repository" element={<Dashboard mode="repository" />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </MockDataProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe('Dashboard invoice list visibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(['ACCOUNTING_SUPERVISOR', 'ACCOUNTING_ASSOCIATE'])(
    'hides the dashboard invoice list card and filter panel for %s',
    async (role) => {
      seedUser(role);
      renderDashboard();
      // The list is briefly rendered before the auth effect applies the role —
      // waitFor settles the providers before asserting it is gone.
      await waitFor(() => {
        expect(screen.queryByText('Invoice Repository')).not.toBeInTheDocument();
        expect(screen.queryByText('Filter Invoices')).not.toBeInTheDocument();
      });
      // Sanity: the dashboard itself still rendered.
      expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    }
  );

  it('keeps the dashboard invoice list card and filter panel for PURCHASING_COORDINATOR', async () => {
    seedUser('PURCHASING_COORDINATOR');
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Invoice Repository')).toBeInTheDocument();
      expect(screen.getByText('Filter Invoices')).toBeInTheDocument();
    });
  });

  it('keeps the dashboard invoice list card for IT_ADMIN (only the filter panel is hidden)', async () => {
    seedUser('IT_ADMIN');
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Invoice Repository')).toBeInTheDocument();
      expect(screen.queryByText('Filter Invoices')).not.toBeInTheDocument();
    });
  });
});

// The status filter is a native <select>; find it via its well-known first
// option and return that option so tests can assert the selected value.
function getSelectedStatusOption(label: string): HTMLOptionElement {
  return screen.getByRole('option', { name: label }) as HTMLOptionElement;
}

describe('Dashboard KPI → repository navigation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('navigates accounting users to /repository with the ON_HOLD filter applied when clicking the Accounting On Hold KPI', async () => {
    seedUser('ACCOUNTING_ASSOCIATE');
    renderDashboardWithRoutes('/dashboard');

    const kpi = await screen.findByText('Accounting On Hold');
    // The click target is the KPI card wrapping the label.
    fireEvent.click(kpi.closest('div.rounded-2xl')!);

    // Navigation happened — the repository page heading is now showing.
    await screen.findByText('Open an invoice to approve, reject, post, and manage payments');
    // The status filter carried over from the KPI mapping ("hold" → ON_HOLD).
    // getByDisplayValue on a <select> matches the selected option's *text*,
    // which the app renders as "ON HOLD" (underscores become spaces).
    await waitFor(() => {
      expect(getSelectedStatusOption('ON HOLD').selected).toBe(true);
    });
  });

  it('navigates accounting users to /repository unfiltered when clicking the Accounting Queue KPI', async () => {
    seedUser('ACCOUNTING_ASSOCIATE');
    renderDashboardWithRoutes('/dashboard');

    fireEvent.click(await screen.findByText('Accounting Queue'));

    await screen.findByText('Open an invoice to approve, reject, post, and manage payments');
    // No query params → the status filter stays on its default.
    await waitFor(() => {
      expect(getSelectedStatusOption('All Statuses').selected).toBe(true);
    });
  });
});
