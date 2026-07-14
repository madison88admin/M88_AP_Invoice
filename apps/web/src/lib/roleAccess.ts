// Role-based permissions
export const ROLE_PERMISSIONS = {
  SUPERADMIN: {
    canApprove: false,
    canReject: false,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canValidate: false,
    canRequestApproval: false,
    canViewAllInvoices: false,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: true,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: true,
    canViewErrorLogs: true,
    canConfigureSystem: true,
  },
  ACCOUNTING_ASSOCIATE: {
    canApprove: false,
    canReject: false,
    canPost: true,
    canSchedulePayment: true,
    canManagePaymentBatches: true,
    canUpload: false,
    canValidate: false,
    canRequestApproval: false,
    canViewAllInvoices: false,
    canViewMyInvoices: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
  },
  ACCOUNTING_SUPERVISOR: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canManagePaymentBatches: false,
    canViewPaymentBatches: true,
    canUpload: false,
    canValidate: false,
    canRequestApproval: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
  },
  PURCHASING_COORDINATOR: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: true,
    canValidate: true,
    canRequestApproval: true,
    canViewAllInvoices: false,
    canViewPendingApprovals: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
  },
  PURCHASING_MANAGER: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: true,
    canViewPendingApprovals: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
    canViewTeamPerformance: true,
    canEscalate: true,
  },
  MLO_ACCOUNT_HOLDER: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: false,
    canViewBrandFilteredInvoices: true,
    canViewPendingApprovals: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
  },
  PLANNING_MANAGER: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: false,
    canViewBrandFilteredInvoices: true,
    canViewPendingApprovals: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
  },
  SR_MANAGER_GLOBAL_PRODUCTION: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: false,
    canViewProductionInvoices: true,
    canViewPendingApprovals: true,
    canViewReports: true,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
    canViewProductionCosts: true,
  },
  MS_POLLY: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: false,
    canViewHighValueInvoices: true,
    canViewReports: false,
    canViewFinancialReports: false,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
    canViewExecutiveSummary: true,
  },
  PRESIDENT: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canViewFinancialReports: true,
    canManageUsers: true,
    canEditInvoice: false,
    canDeleteInvoice: false,
    canViewSystemHealth: false,
    canViewErrorLogs: false,
    canConfigureSystem: false,
    canViewExecutiveSummary: true,
  },
  IT_ADMIN: {
    canApprove: false,
    canReject: false,
    canPost: true,
    canSchedulePayment: false,
    canUpload: true,
    canValidate: true,
    canRequestApproval: true,
    canViewAllInvoices: true,
    canViewReports: true,
    canViewFinancialReports: true,
    canManageUsers: true,
    canEditInvoice: true,
    canDeleteInvoice: false,
    canViewSystemHealth: true,
    canViewErrorLogs: true,
    canConfigureSystem: true,
    canViewInvoicesReadOnly: true,
  },
};

// Role-based invoice stage access
export const ROLE_STAGE_ACCESS: Record<string, string[]> = {
  SUPERADMIN: [], // System maintenance only — no invoice stage access
  ACCOUNTING_ASSOCIATE: ['VALIDATION_PENDING', 'APPROVED', 'POSTED_TO_QB', 'PENDING_ACCOUNTING', 'ON_HOLD', 'PAID', 'PAYMENT_CONFIRMATION_SENT'],
  ACCOUNTING_SUPERVISOR: ['VALIDATION_PENDING', 'PENDING_ACCOUNTING', 'APPROVED', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'ON_HOLD', 'PAID', 'PAYMENT_CONFIRMATION_SENT'],
  PURCHASING_COORDINATOR: ['VALIDATION_PENDING', 'EXCEPTION_FLAGGED', 'PENDING_COORDINATOR', 'ON_HOLD'],
  PURCHASING_MANAGER: ['PENDING_MANAGER'],
  MLO_ACCOUNT_HOLDER: ['PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER'],
  PLANNING_MANAGER: ['PENDING_MLO_PLANNING_MANAGER'],
  SR_MANAGER_GLOBAL_PRODUCTION: ['PENDING_SR_MANAGER'],
  MS_POLLY: ['PENDING_POLLY'],
  PRESIDENT: ['PENDING_ACCOUNTING', 'POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'],
  IT_ADMIN: [], // System maintenance only; cannot approve/reject/hold
};

// Check if a role has a specific permission
export function hasPermission(role: string, permission: string): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  if (!rolePermissions) return false;
  return (rolePermissions as any)[permission];
}

// Check if a role can access a specific invoice stage
export function canAccessStage(role: string, stage: string): boolean {
  if (role === 'SUPERADMIN') return false; // No invoice stage access
  const accessibleStages = ROLE_STAGE_ACCESS[role];
  if (!accessibleStages) return false;
  return accessibleStages.includes(stage);
}

// Check if a user with the given role can approve/reject an invoice in the given status
export function canUserApproveStatus(role: string, status: string): boolean {
  if (!hasPermission(role, 'canApprove')) return false;
  if (role === 'PRESIDENT') return true;
  return canAccessStage(role, status);
}

// Get invoices filtered by role's accessible stages
export function filterInvoicesByRole(invoices: any[], role: string): any[] {
  if (role === 'SUPERADMIN') return []; // No invoice visibility
  if (role === 'IT_ADMIN') return invoices; // Read-only all invoices
  const accessibleStages = ROLE_STAGE_ACCESS[role];
  if (!accessibleStages || accessibleStages.length === 0) return invoices;
  return invoices.filter(inv => accessibleStages.includes(inv.status) || accessibleStages.includes(inv.current_stage));
}
