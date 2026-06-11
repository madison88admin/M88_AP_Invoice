import { Invoice, InvoiceStatus } from '@ap-invoice/shared';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { FileText, Calendar, DollarSign, Eye, Check, Flag } from 'lucide-react';

interface InvoiceTableProps {
  invoices: Invoice[];
  onInvoiceClick?: (invoice: Invoice) => void;
  loading?: boolean;
}

const statusColors: Record<InvoiceStatus, { bg: string; text: string }> = {
  PENDING_VALIDATION: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  VALIDATED: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  EXCEPTION: { bg: 'bg-red-500/20', text: 'text-red-400' },
  PENDING_APPROVAL: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  APPROVED: { bg: 'bg-green-500/20', text: 'text-green-400' },
  REJECTED: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
  POSTED: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  PAYMENT_INITIATED: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  PAID: { bg: 'bg-green-500/20', text: 'text-green-400' },
};

export default function InvoiceTable({ invoices, onInvoiceClick, loading = false }: InvoiceTableProps) {
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
            <th className="px-4 py-3 text-left">
              <input type="checkbox" className="rounded" style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }} />
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Invoice #
            </th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Vendor
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
            <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" style={{ letterSpacing: '0.08em', fontSize: '11px' }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {invoices.map((invoice) => (
            <tr
              key={invoice.id}
              className="cursor-pointer group"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 150ms ease' }}
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
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <FileText className="h-4 w-4 text-slate-400 mr-2" />
                  <span className="text-sm font-medium text-white">
                    {invoice.invoice_number}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-200">
                {invoice.vendor?.name || 'Unknown'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-slate-400 mr-2" />
                  {invoice.invoice_due_date ? formatDate(invoice.invoice_due_date) : formatDate(invoice.invoice_date)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">
                <div className="flex items-center">
                  <DollarSign className="h-4 w-4 text-slate-400 mr-1" />
                  {formatCurrency(Number(invoice.amount), invoice.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-200">
                {invoice.category.replace(/_/g, ' ')}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={cn(
                    'px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full',
                    statusColors[invoice.status]?.bg,
                    statusColors[invoice.status]?.text
                  )}
                >
                  {invoice.status.replace(/_/g, ' ')}
                </span>
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
          {invoices.length === 0 && (
            <tr>
              <td colSpan={8} className="px-6 py-12 text-center">
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
