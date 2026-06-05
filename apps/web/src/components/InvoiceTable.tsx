import { Invoice, InvoiceStatus } from '@ap-invoice/shared';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { FileText, Calendar, DollarSign, AlertTriangle } from 'lucide-react';

interface InvoiceTableProps {
  invoices: Invoice[];
  onInvoiceClick?: (invoice: Invoice) => void;
}

const statusColors: Record<InvoiceStatus, string> = {
  PENDING_VALIDATION: 'bg-yellow-100 text-yellow-800',
  VALIDATED: 'bg-blue-100 text-blue-800',
  EXCEPTION: 'bg-red-100 text-red-800',
  PENDING_APPROVAL: 'bg-purple-100 text-purple-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-gray-100 text-gray-800',
  POSTED: 'bg-indigo-100 text-indigo-800',
  PAYMENT_INITIATED: 'bg-orange-100 text-orange-800',
  PAID: 'bg-emerald-100 text-emerald-800',
};

export default function InvoiceTable({ invoices, onInvoiceClick }: InvoiceTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Invoice No
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Vendor
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Amount
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Category
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Priority
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {invoices.map((invoice) => (
            <tr
              key={invoice.id}
              className={cn(
                'hover:bg-gray-50 cursor-pointer transition-colors',
                invoice.priority === 'URGENT' && 'bg-red-50 hover:bg-red-100'
              )}
              onClick={() => onInvoiceClick?.(invoice)}
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center">
                  <FileText className="h-4 w-4 text-gray-400 mr-2" />
                  <span className="text-sm font-medium text-gray-900">
                    {invoice.invoice_number}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {invoice.vendor?.name || 'Unknown'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                <div className="flex items-center">
                  <DollarSign className="h-4 w-4 text-gray-400 mr-1" />
                  {formatCurrency(Number(invoice.amount), invoice.currency)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                  {formatDate(invoice.invoice_date)}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {invoice.invoice_type}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {invoice.category}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={cn(
                    'px-2 inline-flex text-xs leading-5 font-semibold rounded-full',
                    statusColors[invoice.status]
                  )}
                >
                  {invoice.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {invoice.priority === 'URGENT' && (
                  <div className="flex items-center text-red-600">
                    <AlertTriangle className="h-4 w-4 mr-1" />
                    <span className="text-xs font-semibold">URGENT</span>
                  </div>
                )}
                {invoice.priority === 'HIGH' && (
                  <span className="text-xs font-semibold text-orange-600">HIGH</span>
                )}
                {invoice.priority === 'NORMAL' && (
                  <span className="text-xs text-gray-500">Normal</span>
                )}
              </td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                No invoices found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
