import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, FileText, CheckCircle, Shield, LucideIcon } from 'lucide-react';
import { calcWorkingHoursElapsed } from '@ap-invoice/shared';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import EmptyState from './ui/EmptyState';

interface BottleneckItem {
  id: string;
  invoice_number: string;
  vendor_name: string;
  amount: number;
  currency: string;
  status?: string;
  current_stage?: string;
  stage_entered_at?: string;
  sla_hours?: number;
  remaining_hours?: number;
  elapsed_hours?: number;
  risk_level?: 'CRITICAL' | 'WARNING';
  stage?: string;
}

interface BottleneckData {
  waiting_on_me: BottleneckItem[];
  at_risk: BottleneckItem[];
  awaiting_cisi: BottleneckItem[];
}

export default function BottleneckView() {
  const { invoices, getInvoicesByStage } = useMockData();
  const { user } = useAuth();
  const [data, setData] = useState<BottleneckData | null>(null);
  const [loading, setLoading] = useState(true);

  const [waitingOnMePage, setWaitingOnMePage] = useState(1);
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [awaitingCISIPage, setAwaitingCISIPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    const waitingOnMe = getInvoicesByStage(
      user?.role === 'PURCHASING_COORDINATOR' ? 'COORDINATOR' :
      user?.role === 'PURCHASING_MANAGER' ? 'PURCHASING_MANAGER' :
      user?.role === 'PLANNING_MANAGER' ? 'MLO_PLANNING_MANAGER' :
      user?.role === 'MLO_PLANNING_MANAGER' ? 'MLO_PLANNING_MANAGER' :
      user?.role === 'MLO_ACCOUNT_HOLDER' ? 'MLO_ACCOUNT_HOLDER' :
      user?.role === 'SR_MANAGER_GLOBAL_PRODUCTION' ? 'SR_MANAGER_GLOBAL_PRODUCTION' :
      user?.role === 'MS_POLLY' ? 'MS_POLLY' :
      user?.role === 'ACCOUNTING_ASSOCIATE' ? 'ACCOUNTING_REVIEWER' :
      user?.role === 'ACCOUNTING_SUPERVISOR' ? 'ACCOUNTING_REVIEWER' :
      user?.role === 'CFO' ? 'ACCOUNTING_REVIEWER' :
      user?.role === 'PRESIDENT' ? 'ACCOUNTING_REVIEWER' : ''
    ).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      vendor_name: inv.vendor_name,
      amount: inv.total_amount,
      currency: inv.currency,
      status: inv.status,
      current_stage: inv.current_stage,
      stage_entered_at: inv.stage_timestamps.find(st => st.stage === inv.current_stage)?.entered_at,
    }));

    const atRisk = invoices.filter(inv => {
      const currentStage = inv.stage_timestamps.find(st => !st.exited_at);
      if (!currentStage) return false;
      const enteredAt = new Date(currentStage.entered_at);
      const now = new Date();
      const elapsedHours = calcWorkingHoursElapsed(enteredAt, now);
      const remainingHours = currentStage.sla_hours - elapsedHours;
      return remainingHours <= 48 && remainingHours > 0;
    }).map(inv => {
      const currentStage = inv.stage_timestamps.find(st => !st.exited_at)!;
      const enteredAt = new Date(currentStage.entered_at);
      const now = new Date();
      const elapsedHours = calcWorkingHoursElapsed(enteredAt, now);
      const remainingHours = currentStage.sla_hours - elapsedHours;
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        vendor_name: inv.vendor_name,
        amount: inv.total_amount,
        currency: inv.currency,
        status: inv.status,
        stage: currentStage.stage,
        remaining_hours: Math.round(remainingHours),
        elapsed_hours: Math.round(elapsedHours),
        risk_level: (remainingHours <= 24 ? 'CRITICAL' : 'WARNING') as 'CRITICAL' | 'WARNING',
      };
    });

    const awaitingCISI = invoices.filter(inv =>
      inv.invoice_type === 'PROFORMA' && inv.status === 'PAID' && inv.follow_up_tasks?.some(ft => ft.status === 'PENDING')
    ).map(inv => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      vendor_name: inv.vendor_name,
      amount: inv.total_amount,
      currency: inv.currency,
      status: inv.status,
    }));

    setData({ waiting_on_me: waitingOnMe, at_risk: atRisk, awaiting_cisi: awaitingCISI });
    setLoading(false);
  }, [invoices, getInvoicesByStage, user]);

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const hours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatHours = (hours?: number) => {
    if (hours === undefined) return 'N/A';
    if (hours <= 0) return 'Overdue';
    if (hours < 1) return '< 1h';
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  };

  const paginateItems = (items: BottleneckItem[], page: number) => {
    const startIndex = (page - 1) * itemsPerPage;
    return items.slice(startIndex, startIndex + itemsPerPage);
  };

  const getTotalPages = (items: BottleneckItem[]) => Math.ceil(items.length / itemsPerPage);

  const paginatedWaitingOnMe = data?.waiting_on_me ? paginateItems(data.waiting_on_me, waitingOnMePage) : [];
  const paginatedAtRisk = data?.at_risk ? paginateItems(data.at_risk, atRiskPage) : [];
  const paginatedAwaitingCISI = data?.awaiting_cisi ? paginateItems(data.awaiting_cisi, awaitingCISIPage) : [];

  const waitingOnMeTotalPages = data?.waiting_on_me ? getTotalPages(data.waiting_on_me) : 1;
  const atRiskTotalPages = data?.at_risk ? getTotalPages(data.at_risk) : 1;
  const awaitingCISITotalPages = data?.awaiting_cisi ? getTotalPages(data.awaiting_cisi) : 1;

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl p-4 animate-pulse" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
            <div className="h-4 rounded w-1/3 mb-3" style={{ background: 'var(--bg-elevated)' }}></div>
            <div className="space-y-2">
              <div className="h-3 rounded" style={{ background: 'var(--bg-elevated)' }}></div>
              <div className="h-3 rounded" style={{ background: 'var(--bg-elevated)' }}></div>
              <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-elevated)' }}></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      <BottleneckCard
        title="Waiting on me"
        icon={Clock}
        count={data?.waiting_on_me.length || 0}
        accent="info"
        emptyIcon={CheckCircle}
        emptyTitle="No invoices waiting"
        emptyDescription="Invoices requiring your approval will appear here."
        items={paginatedWaitingOnMe}
        renderItem={(item) => (
          <BottleneckItem
            item={item}
            formatCurrency={formatCurrency}
            formatTimeAgo={formatTimeAgo}
            formatHours={formatHours}
            showStage
          />
        )}
        pagination={{
          currentPage: waitingOnMePage,
          totalPages: waitingOnMeTotalPages,
          onPageChange: setWaitingOnMePage
        }}
      />

      <BottleneckCard
        title="At risk"
        icon={AlertTriangle}
        count={data?.at_risk.length || 0}
        accent="warning"
        emptyIcon={Shield}
        emptyTitle="No invoices at risk"
        emptyDescription="SLA risks will appear here when due dates approach."
        items={paginatedAtRisk}
        renderItem={(item) => (
          <BottleneckItem
            item={item}
            formatCurrency={formatCurrency}
            formatTimeAgo={formatTimeAgo}
            formatHours={formatHours}
            showRiskLevel
          />
        )}
        pagination={{
          currentPage: atRiskPage,
          totalPages: atRiskTotalPages,
          onPageChange: setAtRiskPage
        }}
      />

      <BottleneckCard
        title="Awaiting CI/SI"
        icon={FileText}
        count={data?.awaiting_cisi.length || 0}
        accent="default"
        emptyIcon={FileText}
        emptyTitle="No proformas awaiting CI/SI"
        emptyDescription="Paid proforma invoices requiring CI/SI will appear here."
        items={paginatedAwaitingCISI}
        renderItem={(item) => (
          <BottleneckItem
            item={item}
            formatCurrency={formatCurrency}
            formatTimeAgo={formatTimeAgo}
            formatHours={formatHours}
          />
        )}
        pagination={{
          currentPage: awaitingCISIPage,
          totalPages: awaitingCISITotalPages,
          onPageChange: setAwaitingCISIPage
        }}
      />
    </div>
  );
}

interface BottleneckCardProps {
  title: string;
  icon: LucideIcon;
  count: number;
  accent: 'info' | 'warning' | 'default';
  emptyIcon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  items: BottleneckItem[];
  renderItem: (item: BottleneckItem) => React.ReactNode;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

const accentStyles = {
  info: {
    borderLeft: '4px solid var(--accent-purple)',
    iconBg: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
    iconColor: 'var(--accent-purple)',
    badgeBg: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)',
    badgeColor: 'var(--accent-purple)',
  },
  warning: {
    borderLeft: '4px solid var(--accent-amber)',
    iconBg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
    iconColor: 'var(--accent-amber)',
    badgeBg: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
    badgeColor: 'var(--accent-amber)',
  },
  default: {
    borderLeft: '4px solid var(--accent-violet)',
    iconBg: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)',
    iconColor: 'var(--accent-violet)',
    badgeBg: 'color-mix(in srgb, var(--accent-violet) 10%, transparent)',
    badgeColor: 'var(--accent-violet)',
  },
};

function BottleneckCard({ title, icon: Icon, count, accent, emptyIcon, emptyTitle, emptyDescription, items, renderItem, pagination }: BottleneckCardProps) {
  const styles = accentStyles[accent];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: styles.borderLeft }}>
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <div className="rounded-lg p-1.5" style={{ background: styles.iconBg }}>
            <Icon className="h-4 w-4" style={{ color: styles.iconColor }} strokeWidth={1.75} />
          </div>
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: styles.badgeBg, color: styles.badgeColor, fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </span>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            compact
          />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg transition-colors" onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                {renderItem(item)}
              </div>
            ))}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                <button
                  onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                  disabled={pagination.currentPage === 1}
                  className="text-xs px-2 py-1 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { if (pagination.currentPage !== 1) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                  onMouseLeave={(e) => { if (pagination.currentPage !== 1) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                >
                  Previous
                </button>
                <span className="text-xs" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {pagination.currentPage} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                  disabled={pagination.currentPage === pagination.totalPages}
                  className="text-xs px-2 py-1 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { if (pagination.currentPage !== pagination.totalPages) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                  onMouseLeave={(e) => { if (pagination.currentPage !== pagination.totalPages) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface BottleneckItemProps {
  item: BottleneckItem;
  formatCurrency: (amount: number, currency: string) => string;
  formatTimeAgo: (dateString?: string) => string;
  formatHours: (hours?: number) => string;
  showStage?: boolean;
  showRiskLevel?: boolean;
}

function BottleneckItem({ item, formatCurrency, formatTimeAgo, formatHours, showStage, showRiskLevel }: BottleneckItemProps) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
          {item.invoice_number}
        </span>
        <span className="text-sm font-semibold ml-2" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(item.amount, item.currency)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span className="truncate">{item.vendor_name}</span>
        {showStage && item.current_stage && (
          <span className="ml-2 px-2 py-0.5 rounded text-[10px]" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            {item.current_stage.replace(/_/g, ' ')}
          </span>
        )}
        {showRiskLevel && item.risk_level && (
          <span className="ml-2 px-2 py-0.5 rounded text-[10px]" style={
            item.risk_level === 'CRITICAL'
              ? { background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)' }
              : { background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)' }
          }>
            {item.risk_level}
          </span>
        )}
      </div>
      {(item.remaining_hours !== undefined || item.stage_entered_at) && (
        <div className="flex items-center justify-between text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {item.remaining_hours !== undefined && (
            <span>{formatHours(item.remaining_hours)} remaining</span>
          )}
          {item.stage_entered_at && (
            <span>{formatTimeAgo(item.stage_entered_at)}</span>
          )}
        </div>
      )}
    </div>
  );
}
