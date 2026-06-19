import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, FileText } from 'lucide-react';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';

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
  
  // Pagination state for each card
  const [waitingOnMePage, setWaitingOnMePage] = useState(1);
  const [atRiskPage, setAtRiskPage] = useState(1);
  const [awaitingCISIPage, setAwaitingCISIPage] = useState(1);
  const itemsPerPage = 3;

  useEffect(() => {
    // Calculate bottleneck data from mock invoices
    const waitingOnMe = getInvoicesByStage(user?.role === 'PURCHASING_COORDINATOR' ? 'PURCHASING_COORDINATOR' : 
                                      user?.role === 'PURCHASING_MANAGER' ? 'PURCHASING_MANAGER' :
                                      user?.role === 'PLANNING_MANAGER' ? 'PLANNING_MANAGER' :
                                      user?.role === 'SR_MANAGER_GLOBAL_PRODUCTION' ? 'LINDSEY' :
                                      user?.role === 'MS_POLLY' ? 'POLLY' : '').map(inv => ({
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
      const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
      const remainingHours = currentStage.sla_hours - elapsedHours;
      return remainingHours <= 48 && remainingHours > 0;
    }).map(inv => {
      const currentStage = inv.stage_timestamps.find(st => !st.exited_at);
      const enteredAt = new Date(currentStage!.entered_at);
      const now = new Date();
      const elapsedHours = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60);
      const remainingHours = currentStage!.sla_hours - elapsedHours;
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        vendor_name: inv.vendor_name,
        amount: inv.total_amount,
        currency: inv.currency,
        status: inv.status,
        stage: currentStage!.stage,
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

  // Helper function to paginate items
  const paginateItems = (items: BottleneckItem[], page: number) => {
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return items.slice(startIndex, endIndex);
  };

  // Helper function to get total pages
  const getTotalPages = (items: BottleneckItem[]) => {
    return Math.ceil(items.length / itemsPerPage);
  };

  // Paginated items
  const paginatedWaitingOnMe = data?.waiting_on_me ? paginateItems(data.waiting_on_me, waitingOnMePage) : [];
  const paginatedAtRisk = data?.at_risk ? paginateItems(data.at_risk, atRiskPage) : [];
  const paginatedAwaitingCISI = data?.awaiting_cisi ? paginateItems(data.awaiting_cisi, awaitingCISIPage) : [];

  // Total pages
  const waitingOnMeTotalPages = data?.waiting_on_me ? getTotalPages(data.waiting_on_me) : 1;
  const atRiskTotalPages = data?.at_risk ? getTotalPages(data.at_risk) : 1;
  const awaitingCISITotalPages = data?.awaiting_cisi ? getTotalPages(data.awaiting_cisi) : 1;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3"></div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Waiting on Me */}
      <BottleneckCard
        title="Waiting on me"
        icon={<Clock className="w-5 h-5 text-blue-600" />}
        items={paginatedWaitingOnMe}
        color="blue"
        emptyMessage="No invoices waiting for your approval"
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

      {/* At Risk */}
      <BottleneckCard
        title="At risk"
        icon={<AlertTriangle className="w-5 h-5 text-orange-600" />}
        items={paginatedAtRisk}
        color="orange"
        emptyMessage="No invoices at risk of SLA breach"
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

      {/* Awaiting CI/SI */}
      <BottleneckCard
        title="Awaiting CI/SI"
        icon={<FileText className="w-5 h-5 text-purple-600" />}
        items={paginatedAwaitingCISI}
        color="purple"
        emptyMessage="No Proforma Invoices awaiting CI/SI"
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
  icon: React.ReactNode;
  items: BottleneckItem[];
  color: 'blue' | 'orange' | 'purple';
  emptyMessage: string;
  renderItem: (item: BottleneckItem) => React.ReactNode;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

function BottleneckCard({ title, icon, items, color, emptyMessage, renderItem, pagination }: BottleneckCardProps) {
  const badgeClasses = {
    blue: 'bg-blue-500/20 text-blue-400',
    orange: 'bg-orange-500/20 text-orange-400',
    purple: 'bg-purple-500/20 text-purple-400',
  };

  return (
    <div className="bg-[#1e1b4b] rounded-lg shadow-sm border border-white/10 overflow-hidden">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-semibold text-white">{title}</h3>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeClasses[color]}`}>
          {items.length}
        </span>
      </div>
      <div className="p-4">
        {items.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">{emptyMessage}</p>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-2 rounded hover:bg-white/5 transition-colors">
                {renderItem(item)}
              </div>
            ))}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t border-white/10">
                <button
                  onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
                  disabled={pagination.currentPage === 1}
                  className="text-xs px-2 py-1 rounded bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-400">
                  {pagination.currentPage} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
                  disabled={pagination.currentPage === pagination.totalPages}
                  className="text-xs px-2 py-1 rounded bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        <span className="font-medium text-sm text-white truncate">
          {item.invoice_number}
        </span>
        <span className="text-sm font-semibold text-white ml-2">
          {formatCurrency(item.amount, item.currency)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="truncate">{item.vendor_name}</span>
        {showStage && item.current_stage && (
          <span className="ml-2 px-2 py-0.5 bg-white/10 rounded text-slate-300">
            {item.current_stage.replace(/_/g, ' ')}
          </span>
        )}
        {showRiskLevel && item.risk_level && (
          <span className={`ml-2 px-2 py-0.5 rounded ${
            item.risk_level === 'CRITICAL' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}>
            {item.risk_level}
          </span>
        )}
      </div>
      {(item.remaining_hours !== undefined || item.stage_entered_at) && (
        <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
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
