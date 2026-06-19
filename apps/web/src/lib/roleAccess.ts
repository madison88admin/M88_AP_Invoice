// Role-based permissions
export const ROLE_PERMISSIONS = {
  SUPERADMIN: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: true,
    canEditInvoice: true,
    canDeleteInvoice: true,
  },
  ADMIN: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canUpload: true,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: true,
    canEditInvoice: true,
    canDeleteInvoice: true,
  },
  ACCOUNTING_ASSOCIATE: {
    canApprove: false,
    canReject: false,
    canPost: true,
    canSchedulePayment: false,
    canUpload: true,
    canViewAllInvoices: false,
    canViewReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
  },
  ACCOUNTING_SUPERVISOR: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canUpload: true,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
  },
  PURCHASING_COORDINATOR: {
    canApprove: false,
    canReject: false,
    canPost: false,
    canSchedulePayment: false,
    canUpload: true,
    canViewAllInvoices: false,
    canViewReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
  },
  PURCHASING_MANAGER: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: true,
    canViewAllInvoices: true,
    canViewReports: false,
    canManageUsers: false,
    canEditInvoice: true,
    canDeleteInvoice: false,
  },
  PLANNING_MANAGER: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
  SR_MANAGER_GLOBAL_PRODUCTION: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
  MS_POLLY: {
    canApprove: true,
    canReject: true,
    canPost: false,
    canSchedulePayment: false,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
  CFO: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: false,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
  PRESIDENT: {
    canApprove: true,
    canReject: true,
    canPost: true,
    canSchedulePayment: true,
    canUpload: false,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: true,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
  IT_ADMIN: {
    canApprove: false,
    canReject: false,
    canPost: false,
    canSchedulePayment: false,
    canUpload: true,
    canViewAllInvoices: true,
    canViewReports: true,
    canManageUsers: true,
    canEditInvoice: false,
    canDeleteInvoice: false,
  },
};

// Role-based invoice stage access
export const ROLE_STAGE_ACCESS: Record<string, string[]> = {
  SUPERADMIN: [], // Superadmin can access all stages
  ACCOUNTING_ASSOCIATE: ['VALIDATION_PENDING', 'PENDING_ACCOUNTING'],
  ACCOUNTING_SUPERVISOR: ['VALIDATION_PENDING', 'PENDING_ACCOUNTING', 'APPROVED'],
  PURCHASING_COORDINATOR: ['PENDING_COORDINATOR'],
  PURCHASING_MANAGER: ['PENDING_COORDINATOR', 'PENDING_MANAGER'],
  PLANNING_MANAGER: ['PENDING_MLO_PLANNING_MANAGER'],
  SR_MANAGER_GLOBAL_PRODUCTION: ['PENDING_SR_MANAGER'],
  MS_POLLY: ['PENDING_POLLY'],
  CFO: ['POSTED_TO_QB', 'PAYMENT_SCHEDULED'],
  PRESIDENT: ['POSTED_TO_QB', 'PAYMENT_SCHEDULED', 'PAID'],
  ADMIN: [], // Admin can access all stages
  IT_ADMIN: [], // IT Admin can view all stages but not approve
};

// Check if a role has a specific permission
export function hasPermission(role: string, permission: string): boolean {
  const rolePermissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  if (!rolePermissions) return false;
  return (rolePermissions as any)[permission];
}

// Check if a role can access a specific invoice stage
export function canAccessStage(role: string, stage: string): boolean {
  if (role === 'ADMIN' || role === 'SUPERADMIN') return true;
  const accessibleStages = ROLE_STAGE_ACCESS[role];
  if (!accessibleStages) return false;
  return accessibleStages.includes(stage);
}

// Get invoices filtered by role's accessible stages
export function filterInvoicesByRole(invoices: any[], role: string): any[] {
  if (role === 'ADMIN' || role === 'SUPERADMIN' || role === 'IT_ADMIN') return invoices;
  const accessibleStages = ROLE_STAGE_ACCESS[role];
  if (!accessibleStages || accessibleStages.length === 0) return invoices;
  return invoices.filter(inv => accessibleStages.includes(inv.status) || accessibleStages.includes(inv.current_stage));
}
