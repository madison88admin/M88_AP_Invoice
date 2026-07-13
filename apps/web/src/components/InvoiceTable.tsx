import { InvoiceStatus, OrderType, calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { formatCurrency, formatDate } from '../lib/utils';
import { FileText, Calendar, DollarSign, Eye, Check, Flag } from 'lucide-react';
import { MockInvoice } from '../lib/mockData';
import { POValidationBadge } from './POValidationBadge';
import { Skeleton } from './ui/Skeleton';

interface InvoiceTableProps {
  invoices: MockInvoice[];
  onInvoiceClick?: (invoice: MockInvoice) => void;
  loading?: boolean;
  emptyHint?: 'filters' | 'default';
}

const statusColors: Partial<Record<InvoiceStatus, { bg: string; color: string }>> = {
  [InvoiceStatus.RECEIVED]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.OCR_PROCESSING]: { bg: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)', color: 'var(--accent-violet)' },
  [InvoiceStatus.VALIDATION_PENDING]: { bg: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' },
  [InvoiceStatus.EXCEPTION_FLAGGED]: { bg: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' },
  [InvoiceStatus.PENDING_COORDINATOR]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_MANAGER]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_SR_MANAGER]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_POLLY]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  [InvoiceStatus.PENDING_ACCOUNTING]: { bg: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' },
  [InvoiceStatus.APPROVED]: { bg: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)', color: 'var(--accent-lime)' },
  [InvoiceStatus.POSTED_TO_QB]: { bg: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' },
  [InvoiceStatus.PAYMENT_SCHEDULED]: { bg: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' },
  [InvoiceStatus.PAID]: { bg: 'color-mix(in srgb, var(--accent-lime) 10%, transparent)', color: 'var(--accent-lime)' },
  [InvoiceStatus.PAYMENT_CONFIRMATION_SENT]: { bg: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', color: 'var(--accent-green)' },
  [InvoiceStatus.REJECTED]: { bg: 'color-mix(in srgb, var(--text-muted) 10%, transparent)', color: 'var(--text-secondary)' },
  [InvoiceStatus.ON_HOLD]: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
};

const orderTypeColors: Record<OrderType, { bg: string; color: string }> = {
  BULK: { bg: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', color: 'var(--accent-lime)' },
  SMS: { bg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' },
  SAMPLE: { bg: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)', color: 'var(--accent-violet)' },
};

function getSLAStatus(invoice: MockInvoice): { label: string; bg: string; color: string } | null {
  const timestamps = (invoice as any).stage_timestamps || [];
  const current = timestamps.find((t: any) => t.stage === invoice.status && !t.exited_at);
  if (!current || !current.sla_hours) return null;
  const enteredAt = new Date(current.entered_at);
  const now = new Date();
  const elapsedHours = calcWorkingHoursElapsed(enteredAt, now);
  const hoursRemaining = current.sla_hours - elapsedHours;
  if (hoursRemaining <= 0) return { label: 'Overdue', bg: 'var(--accent-red)', color: 'var(--text-inverse)' };
  if (hoursRemaining <= 24) return { label: 'Due soon', bg: 'var(--accent-amber)', color: 'var(--text-primary)' };
  return null;
}

export default function InvoiceTable({ invoices, onInvoiceClick, loading = false, emptyHint = 'default' }: InvoiceTableProps) {
  // Use invoices as-is
  const sortedInvoices = invoices;

  if (loading) {
    return (
      <div className="px-6 py-4">
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3" style={{ animationDelay: `${i * 60}ms` }}>
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 flex items-center gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
          <tr>
            <th className="px-4 py-3 text-left" style={{ width: '32px' }}>
              <input type="checkbox" className="rounded" style={{ accentColor: 'var(--accent-lime)' }} />
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '32px', color: 'var(--text-muted)' }}>
              Priority
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Invoice #
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Vendor
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '140px', color: 'var(--text-muted)' }}>
              Brand
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '80px', color: 'var(--text-muted)' }}>
              Brand Tier
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '80px', color: 'var(--text-muted)' }}>
              Order Type
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '60px', color: 'var(--text-muted)' }}>
              Season
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '100px', color: 'var(--text-muted)' }}>
              MPO #
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Date Due
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Amount
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Category
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Status
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '160px', color: 'var(--text-muted)' }}>
              NextGen Validation
            </th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ width: '60px', color: 'var(--text-muted)' }}>
              Signatures
            </th>
            <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {sortedInvoices.map((invoice, index) => (
            <tr
              key={invoice.id}
              className="cursor-pointer group transition-colors duration-150 animate-fade-in"
              style={{
                backgroundColor: index % 2 === 0 ? 'transparent' : 'var(--bg-card-hover)',
                borderLeft: '3px solid transparent',
                animationDelay: `${index * 30}ms`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderLeftColor = 'var(--accent-lime)';
                e.currentTarget.style.background = 'var(--bg-card-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderLeftColor = 'transparent';
                e.currentTarget.style.background = index % 2 === 0 ? 'transparent' : 'var(--bg-card-hover)';
              }}
              onClick={() => onInvoiceClick?.(invoice)}
            >
              <td className="px-4 py-4">
                <input type="checkbox" className="rounded" style={{ accentColor: 'var(--accent-lime)' }} />
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '32px' }}>
                {/* Priority flag column */}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {invoice.invoice_number}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                {invoice.vendor_name || 'Unknown'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm" style={{ width: '140px', color: 'var(--text-secondary)' }}>
                {invoice.brand || '—'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '80px' }}>
                {invoice.brand_tier && (
                  <span
                    className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                    style={{ background: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)', border: '1px solid color-mix(in srgb, var(--accent-blue) 20%, transparent)' }}
                  >
                    {invoice.brand_tier}
                  </span>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '80px' }}>
                {invoice.order_type && (
                  <span
                    className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                    style={{ background: orderTypeColors[invoice.order_type as OrderType]?.bg, color: orderTypeColors[invoice.order_type as OrderType]?.color, border: '1px solid var(--border-color)' }}
                  >
                    {invoice.order_type}
                  </span>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm" style={{ width: '60px', color: 'var(--text-secondary)' }}>
                {invoice.season || '—'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm" style={{ width: '100px', color: 'var(--text-secondary)' }}>
                {invoice.mpo_number || '—'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-muted)' }}>
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 mr-2" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  {invoice.invoice_date ? formatDate(invoice.invoice_date) : '—'}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                <div className="flex items-center">
                  <DollarSign className="h-4 w-4 mr-1" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                  {formatCurrency(Number(invoice.total_amount), invoice.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm" style={{ color: 'var(--text-secondary)' }}>
                {(invoice.category || invoice.invoice_type).replace(/_/g, ' ')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col gap-1">
                  <span
                    className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full w-fit"
                    style={{ background: statusColors[invoice.status]?.bg, color: statusColors[invoice.status]?.color, border: '1px solid var(--border-color)' }}
                  >
                    {invoice.status.replace(/_/g, ' ')}
                  </span>
                  {(() => {
                    const sla = getSLAStatus(invoice);
                    return sla ? (
                      <span className="px-2 py-0.5 inline-flex text-[10px] leading-4 font-semibold rounded-full w-fit" style={{ background: sla.bg, color: sla.color }}>
                        {sla.label}
                      </span>
                    ) : null;
                  })()}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap" style={{ width: '160px' }} onClick={(e) => e.stopPropagation()}>
                <POValidationBadge
                  invoiceId={invoice.id}
                  initialStatus={(invoice as any).po_validation_status || 'PENDING'}
                />
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm" style={{ width: '60px' }}>
                {invoice.signatures && invoice.signatures.length > 0 ? (
                  <span className="text-xs font-semibold" style={{
                    color: invoice.signatures.filter(s => s.signed_at).length === invoice.signatures.length ? 'var(--accent-lime)' :
                    invoice.signatures.filter(s => s.signed_at).length > 0 ? 'var(--accent-amber)' : 'var(--accent-red)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {invoice.signatures.filter(s => s.signed_at).length}/{invoice.signatures.length}
                  </span>
                ) : '—'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInvoiceClick?.(invoice);
                    }}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-blue)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    title="View Details"
                  >
                    <Eye className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInvoiceClick?.(invoice);
                    }}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-lime)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    title="Approve"
                  >
                    <Check className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInvoiceClick?.(invoice);
                    }}
                    className="p-2 rounded-xl transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-red)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                    title="Flag"
                  >
                    <Flag className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {sortedInvoices.length === 0 && (
            <tr>
              <td colSpan={16} className="px-6 py-12 text-center">
                <div className="flex flex-col items-center justify-center">
                  <div className="p-4 rounded-2xl mb-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                    <FileText className="h-12 w-12" style={{ color: 'var(--text-muted)', animation: 'pulse-soft 2.5s ease-in-out infinite' }} />
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No invoices found</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {emptyHint === 'filters' ? 'No invoices match the active filters — try clearing them.' : 'Upload an invoice to get started'}
                  </p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
