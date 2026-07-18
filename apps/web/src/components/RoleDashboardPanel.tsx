import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle, Clock, CreditCard, FileText, Loader2, Package } from 'lucide-react';
import { dashboardApi } from '../lib/api';

interface RoleDashboardData {
  title: string;
  primary_href: string;
  summary: Record<string, number>;
  status_counts: Array<{ status: string; count: number }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    vendor_name: string;
    total_amount: number;
    currency: string;
    status: string;
    due_date?: string;
    priority_flag?: boolean;
    exception_count?: number;
  }>;
  payments: Array<{
    id: string;
    invoice_number: string;
    vendor_name: string;
    amount: number;
    currency: string;
    payment_date: string;
    status: string;
  }>;
  batches: Array<{
    id: string;
    batch_number: string;
    total_amount: number;
    payment_count: number;
    status: string;
  }>;
}

export default function RoleDashboardPanel() {
  const [data, setData] = useState<RoleDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    dashboardApi.getRoleDashboard()
      .then((res) => { if (mounted) setData(res.data); })
      .catch(() => { if (mounted) setData(null); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="p-4 rounded-xl flex items-center gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
        Loading your work queue...
      </div>
    );
  }

  if (!data) return null;

  const queueItems = [
    ...data.batches.map((batch) => ({
      id: `batch:${batch.id}`,
      icon: Package,
      href: '/payment-batches',
      title: batch.batch_number,
      subtitle: `${batch.payment_count} payments | ${batch.status}`,
      amount: batch.total_amount,
      currency: 'USD',
    })),
    ...data.payments.map((payment) => ({
      id: `payment:${payment.id}`,
      icon: CreditCard,
      href: '/payment-batches',
      title: payment.invoice_number,
      subtitle: `${payment.vendor_name} | ${new Date(payment.payment_date).toLocaleDateString()}`,
      amount: payment.amount,
      currency: payment.currency,
    })),
    ...data.invoices.map((invoice) => ({
      id: `invoice:${invoice.id}`,
      icon: invoice.exception_count ? AlertTriangle : FileText,
      href: `/repository?invoiceId=${invoice.id}`,
      title: invoice.invoice_number,
      subtitle: `${invoice.vendor_name} | ${invoice.status}`,
      amount: invoice.total_amount,
      currency: invoice.currency,
    })),
  ].slice(0, 8);

  const summaryCards = [
    { label: 'Work items', value: data.summary.work_items || 0, icon: FileText },
    { label: 'Scheduled', value: data.summary.scheduled_payments || 0, icon: CreditCard },
    { label: 'Batches', value: data.summary.batches_for_action || 0, icon: Package },
    { label: 'Alerts', value: (data.summary.due_soon || 0) + (data.summary.unread_notifications || 0), icon: Bell },
  ];

  return (
    <section className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="p-5 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{data.title}</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Your live queue based on current role and invoice/payment status</p>
          </div>
          <Link to={data.primary_href} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent-purple)', color: 'white' }}>
            <CheckCircle className="h-4 w-4" strokeWidth={1.75} />
            Open workspace
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <div key={card.label} className="p-3 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{card.label}</span>
                <card.icon className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
              </div>
              <div className="text-2xl font-semibold mt-1" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{card.value}</div>
            </div>
          ))}
        </div>

        {queueItems.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {queueItems.map((item) => (
              <Link key={item.id} to={item.href} className="p-3 rounded-lg flex items-center justify-between gap-3 transition-colors" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <item.icon className="h-4 w-4 shrink-0" style={{ color: 'var(--accent-purple)' }} strokeWidth={1.75} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.subtitle}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold shrink-0" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {item.currency} {item.amount.toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-5 rounded-lg text-center text-sm flex items-center justify-center gap-2" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
            <Clock className="h-4 w-4" strokeWidth={1.75} />
            No pending items for your role right now.
          </div>
        )}
      </div>
    </section>
  );
}
