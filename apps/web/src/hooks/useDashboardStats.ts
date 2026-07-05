import { useQuery } from '@tanstack/react-query';
import { invoiceApi } from '../lib/api';

interface DashboardStats {
  pendingValidation: number;
  awaitingApproval: number;
  urgentPayments: number;
  handwrittenDocs: number;
  slaAtRisk: number;
  paidThisWeek: number;
  totalAmount: number;
  exceptions: number;
  pendingValidationTrend: number;
  awaitingApprovalTrend: number;
  urgentPaymentsTrend: number;
  handwrittenDocsTrend: number;
  slaAtRiskTrend: number;
  paidThisWeekTrend: number;
  totalAmountTrend: number;
  exceptionsTrend: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await invoiceApi.getAll();
      const invoices = response.data || [];

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const pendingValidation = invoices.filter((i: any) => i.status === 'VALIDATION_PENDING').length;
      const awaitingApproval = invoices.filter((i: any) =>
        ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'].includes(i.status)
      ).length;
      const urgentPayments = invoices.filter((i: any) => {
        if (!i.due_date) return false;
        const dueDate = new Date(i.due_date);
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        return dueDate <= threeDaysFromNow && i.status !== 'PAID';
      }).length;
      const handwrittenDocs = invoices.filter((i: any) => i.is_handwritten).length;
      const slaAtRisk = invoices.filter((i: any) =>
        ['VALIDATION_PENDING', 'PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY'].includes(i.status)
      ).length;
      const paidThisWeek = invoices.filter((i: any) => {
        if (!i.paid_at && !i.updated_at) return false;
        const paidAt = new Date(i.paid_at || i.updated_at);
        return i.status === 'PAID' && paidAt >= weekStart && paidAt <= weekEnd;
      }).length;
      const totalAmount = invoices.reduce((sum: number, i: any) => sum + (Number(i.total_amount) || 0), 0);
      const exceptions = invoices.filter((i: any) => i.status === 'EXCEPTION_FLAGGED' || (i.exceptions && i.exceptions.length > 0)).length;

      return {
        pendingValidation,
        awaitingApproval,
        urgentPayments,
        handwrittenDocs,
        slaAtRisk,
        paidThisWeek,
        totalAmount,
        exceptions,
        pendingValidationTrend: 0,
        awaitingApprovalTrend: 0,
        urgentPaymentsTrend: 0,
        handwrittenDocsTrend: 0,
        slaAtRiskTrend: 0,
        paidThisWeekTrend: 0,
        totalAmountTrend: 0,
        exceptionsTrend: 0,
      };
    },
    refetchInterval: 30000,
  });
}
