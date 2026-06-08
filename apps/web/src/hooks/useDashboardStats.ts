import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface DashboardStats {
  pendingValidation: number;
  awaitingApproval: number;
  urgentPayments: number;
  handwrittenDocs: number;
  nonUsdInvoices: number;
  paidThisWeek: number;
  totalAmount: number;
  exceptions: number;
  pendingValidationTrend: number;
  awaitingApprovalTrend: number;
  urgentPaymentsTrend: number;
  handwrittenDocsTrend: number;
  nonUsdInvoicesTrend: number;
  paidThisWeekTrend: number;
  totalAmountTrend: number;
  exceptionsTrend: number;
}

// Mock data for when Supabase is not configured
const mockDashboardStats: DashboardStats = {
  pendingValidation: 12,
  awaitingApproval: 8,
  urgentPayments: 5,
  handwrittenDocs: 3,
  nonUsdInvoices: 7,
  paidThisWeek: 24,
  totalAmount: 125000,
  exceptions: 2,
  pendingValidationTrend: 12,
  awaitingApprovalTrend: 5,
  urgentPaymentsTrend: -3,
  handwrittenDocsTrend: 8,
  nonUsdInvoicesTrend: 15,
  paidThisWeekTrend: 22,
  totalAmountTrend: 18,
  exceptionsTrend: -7,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      // Return mock data if Supabase is not configured
      if (!isSupabaseConfigured || !supabase) {
        return mockDashboardStats;
      }

      // Get current week start and end
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      // Get previous week start and end
      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(weekStart.getDate() - 7);

      const prevWeekEnd = new Date(weekStart);
      prevWeekEnd.setDate(weekStart.getDate() - 1);
      prevWeekEnd.setHours(23, 59, 59, 999);

      // Fetch current week data
      const { data: currentData, error: currentError } = await supabase
        .from('invoices')
        .select('status, amount, currency, is_handwritten, date_due, created_at');

      if (currentError) throw currentError;

      // Fetch previous week data for trends
      const { data: previousData, error: previousError } = await supabase
        .from('invoices')
        .select('status, amount, currency, is_handwritten, date_due, created_at')
        .gte('created_at', prevWeekStart.toISOString())
        .lte('created_at', prevWeekEnd.toISOString());

      if (previousError) throw previousError;

      // Calculate current stats
      const currentStats = {
        pendingValidation: currentData?.filter(i => i.status === 'pending_validation').length || 0,
        awaitingApproval: currentData?.filter(i => i.status === 'awaiting_approval').length || 0,
        urgentPayments: currentData?.filter(i => {
          if (!i.date_due) return false;
          const dueDate = new Date(i.date_due);
          const threeDaysFromNow = new Date();
          threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
          return dueDate <= threeDaysFromNow && i.status !== 'paid';
        }).length || 0,
        handwrittenDocs: currentData?.filter(i => i.is_handwritten).length || 0,
        nonUsdInvoices: currentData?.filter(i => i.currency !== 'USD').length || 0,
        paidThisWeek: currentData?.filter(i => {
          if (!i.created_at) return false;
          const createdAt = new Date(i.created_at);
          return i.status === 'paid' && createdAt >= weekStart && createdAt <= weekEnd;
        }).length || 0,
        totalAmount: currentData?.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) || 0,
        exceptions: currentData?.filter(i => i.status === 'exception').length || 0,
      };

      // Calculate previous week stats for trends
      const previousStats = {
        pendingValidation: previousData?.filter(i => i.status === 'pending_validation').length || 0,
        awaitingApproval: previousData?.filter(i => i.status === 'awaiting_approval').length || 0,
        urgentPayments: previousData?.filter(i => {
          if (!i.date_due) return false;
          const dueDate = new Date(i.date_due);
          const threeDaysFromNow = new Date(prevWeekEnd);
          threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
          return dueDate <= threeDaysFromNow && i.status !== 'paid';
        }).length || 0,
        handwrittenDocs: previousData?.filter(i => i.is_handwritten).length || 0,
        nonUsdInvoices: previousData?.filter(i => i.currency !== 'USD').length || 0,
        paidThisWeek: previousData?.filter(i => i.status === 'paid').length || 0,
        totalAmount: previousData?.reduce((sum, i) => sum + (Number(i.amount) || 0), 0) || 0,
        exceptions: previousData?.filter(i => i.status === 'exception').length || 0,
      };

      // Calculate trends
      const calculateTrend = (current: number, previous: number): number => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };

      return {
        ...currentStats,
        pendingValidationTrend: calculateTrend(currentStats.pendingValidation, previousStats.pendingValidation),
        awaitingApprovalTrend: calculateTrend(currentStats.awaitingApproval, previousStats.awaitingApproval),
        urgentPaymentsTrend: calculateTrend(currentStats.urgentPayments, previousStats.urgentPayments),
        handwrittenDocsTrend: calculateTrend(currentStats.handwrittenDocs, previousStats.handwrittenDocs),
        nonUsdInvoicesTrend: calculateTrend(currentStats.nonUsdInvoices, previousStats.nonUsdInvoices),
        paidThisWeekTrend: calculateTrend(currentStats.paidThisWeek, previousStats.paidThisWeek),
        totalAmountTrend: calculateTrend(currentStats.totalAmount, previousStats.totalAmount),
        exceptionsTrend: calculateTrend(currentStats.exceptions, previousStats.exceptions),
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}
