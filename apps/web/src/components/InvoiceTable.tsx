import { InvoiceStatus, OrderType } from '@ap-invoice/shared';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { FileText, Calendar, DollarSign, Eye, Check, Flag } from 'lucide-react';
import { MockInvoice } from '../lib/mockData';
import { POValidationBadge } from './POValidationBadge';

interface InvoiceTableProps {
  invoices: MockInvoice[];
  onInvoiceClick?: (invoice: MockInvoice) => void;
  loading?: boolean;
}

const statusColors: Partial<Record<InvoiceStatus, { bg: string; text: string }>> = {
  [InvoiceStatus.RECEIVED]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.OCR_PROCESSING]: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  [InvoiceStatus.VALIDATION_PENDING]: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  [InvoiceStatus.EXCEPTION_FLAGGED]: { bg: 'bg-red-500/20', text: 'text-red-400' },
  [InvoiceStatus.PENDING_COORDINATOR]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.PENDING_MANAGER]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.PENDING_SR_MANAGER]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.PENDING_POLLY]: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  [InvoiceStatus.PENDING_ACCOUNTING]: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  [InvoiceStatus.APPROVED]: { bg: 'bg-green-500/20', text: 'text-green-400' },
  [InvoiceStatus.POSTED_TO_QB]: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  [InvoiceStatus.PAYMENT_SCHEDULED]: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  [InvoiceStatus.PAID]: { bg: 'bg-green-500/20', text: 'text-green-400' },
  [InvoiceStatus.REJECTED]: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  [InvoiceStatus.ON_HOLD]: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
};

const orderTypeColors: Record<OrderType, { bg: string; text: string }> = {
  BULK: { bg: 'bg-green-500/20', text: 'text-green-400' },
  SMS: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  SAMPLE: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
};

function getSLAStatus(invoice: MockInvoice): { label: string; color: string } | null {
  const timestamps = (invoice as any).stage_timestamps || [];
  const current = timestamps.find((t: any) => t.stage === invoice.status && !t.exited_at);
  if (!current || !current.sla_hours) return null;
  const entered = new Date(current.entered_at).getTime();
  const due = entered + current.sla_hours * 60 * 60 * 1000;
  const remaining = due - Date.now();
  const hoursRemaining = remaining / (1000 * 60 * 60);
  if (remaining <= 0) return { label: 'Overdue', color: 'bg-red-500 text-white' };
  if (hoursRemaining <= 24) return { label: 'Due soon', color: 'bg-amber-500 text-black' };
  return null;
}

export default function InvoiceTable({ invoices, onInvoiceClick, loading = false }: InvoiceTableProps) {
  // Use invoices as-is
  const sortedInvoices = invoices;

  if (loading) {
    return (
      <div className="px-6 py-4">
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse" style={{ animationDelay: `${i * 100}ms` }}>
              <div className="w-4 h-4 bg-white/10 rounded" />
              <div className="flex-1 h-12 bg-white/5 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-white/5">
        <thead style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <tr>
            <th className="px-4 py-3 text-left" style={{ width: '32px' }}>
              <input type="checkbox" className="rounded" style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }} />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '32px' }}>
              Priority
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Invoice #
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Vendor
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '140px' }}>
              Brand
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '80px' }}>
              Brand Tier
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '80px' }}>
              Order Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '60px' }}>
              Season
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '100px' }}>
              MPO #
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Date Due
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Category
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '160px' }}>
              PO Validation
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px', width: '60px' }}>
              Signatures
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sortedInvoices.map((invoice) => (
            <tr
              key={invoice.id}
              className="cursor-pointer group"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 150ms ease',
                borderLeft: '3px solid transparent'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              onClick={() => onInvoiceClick?.(invoice)}
            >
              <td className="px-4 py-4">
                <input type="checkbox" className="rounded border-white/20 text-[#6366f1] focus:ring-[#6366f1]" />
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '32px' }}>
                {/* Priority flag column */}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <FileText className="h-4 w-4 text-slate-400 mr-2" />
                  <span className="text-sm font-medium text-white">
                    {invoice.invoice_number}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-200">
                {invoice.vendor_name || 'Unknown'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-200" style={{ width: '140px' }}>
                {invoice.brand || '—'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '80px' }}>
                {invoice.brand_tier && (
                  <span
                    className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-500/20 text-blue-400"
                  >
                    {invoice.brand_tier}
                  </span>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap" style={{ width: '80px' }}>
                {invoice.order_type && (
                  <span
                    className={cn(
                      'px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full',
                      orderTypeColors[invoice.order_type as OrderType]?.bg,
                      orderTypeColors[invoice.order_type as OrderType]?.text
                    )}
                  >
                    {invoice.order_type}
                  </span>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-200" style={{ width: '60px' }}>
                {invoice.season || '—'}
              </td>
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-200" style={{ width: '100px' }}>
                {invoice.mpo_number || '—'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-slate-400 mr-2" />
                  {invoice.invoice_date ? formatDate(invoice.invoice_date) : '—'}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">
                <div className="flex items-center">
                  <DollarSign className="h-4 w-4 text-slate-400 mr-1" />
                  {formatCurrency(Number(invoice.total_amount), invoice.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-200">
                {(invoice.category || invoice.invoice_type).replace(/_/g, ' ')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col gap-1">
                  <span
                    className={cn(
                      'px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full w-fit',
                      statusColors[invoice.status]?.bg,
                      statusColors[invoice.status]?.text
                    )}
                  >
                    {invoice.status.replace(/_/g, ' ')}
                  </span>
                  {(() => {
                    const sla = getSLAStatus(invoice);
                    return sla ? (
                      <span className={cn('px-2 py-0.5 inline-flex text-[10px] leading-4 font-semibold rounded-full w-fit', sla.color)}>
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
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-200" style={{ width: '60px' }}>
                {invoice.signatures && invoice.signatures.length > 0 ? (
                  <span className={cn(
                    'text-xs font-semibold',
                    invoice.signatures.filter(s => s.signed_at).length === invoice.signatures.length ? 'text-green-400' :
                    invoice.signatures.filter(s => s.signed_at).length > 0 ? 'text-amber-400' : 'text-red-400'
                  )}>
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
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-white/10 rounded-lg transition-colors"
                    title="View Details"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="p-2 text-slate-400 hover:text-green-400 hover:bg-white/10 rounded-lg transition-colors"
                    title="Approve"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-white/10 rounded-lg transition-colors"
                    title="Flag"
                  >
                    <Flag className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {sortedInvoices.length === 0 && (
            <tr>
              <td colSpan={16} className="px-6 py-12 text-center">
                <div className="flex flex-col items-center justify-center">
                  <FileText className="h-12 w-12 text-slate-600 mb-4" style={{ animation: 'pulse-soft 2.5s ease-in-out infinite' }} />
                  <p className="text-sm text-slate-400">No invoices found</p>
                  <p className="text-xs text-slate-500 mt-1">Upload an invoice to get started</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
