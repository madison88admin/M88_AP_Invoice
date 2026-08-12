import axios from 'axios';

// Use empty base URL since endpoints already include /api
const API_BASE_URL = (import.meta as any).env.VITE_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const invoiceApi = {
  getAll: (filters?: any) => api.get('/api/invoices', { params: filters }),
  getById: (id: string) => api.get(`/api/invoices/${id}`),
  getTimeline: (id: string) => api.get(`/api/invoices/${id}/timeline`),
  getDuplicateInvoices: () => api.get('/api/invoices/duplicates'),
  getDocument: (id: string) => api.get(`/api/invoices/${id}/document`, { responseType: 'blob' }),
  uploadPdf: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/api/invoices/${id}/upload-pdf`, fd);
  },
  getPaymentTerms: () => api.get('/api/invoices/metadata/payment-terms'),
  create: (data: any) => api.post('/api/invoices', data),
  updateStatus: (id: string, status: string) => api.patch(`/api/invoices/${id}/status`, { status }),
  update: (id: string, data: any) => api.patch(`/api/invoices/${id}`, data),
  requestBankChange: (id: string, data: { field: string; current_value: string; requested_value: string; reason: string; attachment?: File }) => {
    const formData = new FormData();
    formData.append('field', data.field);
    formData.append('current_value', data.current_value);
    formData.append('requested_value', data.requested_value);
    formData.append('reason', data.reason);
    if (data.attachment) {
      formData.append('attachment', data.attachment);
    }
    return api.post(`/api/invoices/${id}/request-bank-change`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getBankChangeRequests: () => api.get('/api/invoices/bank-change-requests'),
  getBankChangeRequestsForInvoice: (id: string) => api.get(`/api/invoices/${id}/bank-change-requests`),
  downloadBankChangeAttachment: (requestId: string) => api.get(`/api/invoices/bank-change-requests/${requestId}/attachment`, { responseType: 'blob' }),
  approveBankChangeRequest: (requestId: string) => api.post(`/api/invoices/bank-change-requests/${requestId}/approve`),
  rejectBankChangeRequest: (requestId: string, reason?: string) => api.post(`/api/invoices/bank-change-requests/${requestId}/reject`, { reason }),
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    // Use async upload endpoint to avoid Netlify 30s proxy timeout
    const uploadRes = await api.post('/api/invoices/upload-madison-async', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30000,
    });

    const jobId = uploadRes.data.jobId;
    if (!jobId) throw new Error('No job ID returned from upload');

    // Poll for completion (up to 5 minutes)
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      let pollRes;
      try {
        pollRes = await api.get(`/api/invoices/upload-jobs/${jobId}`, { timeout: 10000 });
      } catch (error: any) {
        if (error?.response?.status === 404) {
          throw new Error('The OCR job is no longer available. The API may have restarted; please upload the file again.');
        }
        throw error;
      }
      const job = pollRes.data;

      if (job.status === 'completed') {
        return { data: job.result };
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'OCR extraction failed');
      }
    }
    throw new Error('OCR extraction timed out after 5 minutes');
  },
  confirmOCR: (id: string, data: any) => api.post(`/api/invoices/${id}/confirm-ocr`, data),
  saveCorrection: (id: string, data: any) => api.post(`/api/invoices/${id}/correct-extraction`, data),
  saveStandaloneCorrection: (data: any) => api.post('/api/invoices/corrections', data),
  validate: async (id: string) => {
    const res = await api.post(`/api/invoices/${id}/validate`, {}, { timeout: 30000 });
    const jobId = res.data.jobId;
    if (!jobId) return res;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await api.get(`/api/invoices/jobs/${jobId}`, { timeout: 10000 });
      if (poll.data.status === 'completed') return { data: poll.data.result };
      if (poll.data.status === 'failed') throw new Error(poll.data.error || 'Validation failed');
    }
    throw new Error('Validation timed out');
  },
  requestApproval: (id: string) => api.post(`/api/invoices/${id}/request-approval`),
  approve: (id: string, signerName: string) => api.post(`/api/invoices/${id}/approve`, { signerName }),
  reject: (id: string, reason: string) => api.post(`/api/invoices/${id}/reject`, { reason }),
  returnForCorrection: (id: string, reason: string, targetRole?: string) => api.post(`/api/invoices/${id}/return`, { reason, targetRole }),
  post: (id: string, bypassVarianceCheck: boolean = false) => api.post(`/.netlify/functions/proxy-api/invoices/${id}/post`, { bypassVarianceCheck }, { timeout: 300000 }),
  releaseHold: (id: string) => api.post(`/api/invoices/${id}/release-hold`),
  holdForBatchThreshold: (id: string, reason?: string) => api.post(`/api/invoices/${id}/hold`, { reason }),
  checkNextGen: async (id: string) => {
    const res = await api.post(`/api/invoices/${id}/check-nextgen`, {}, { timeout: 30000 });
    const jobId = res.data.jobId;
    if (!jobId) return res;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await api.get(`/api/invoices/jobs/${jobId}`, { timeout: 10000 });
      if (poll.data.status === 'completed') return { data: poll.data.result };
      if (poll.data.status === 'failed') throw new Error(poll.data.error || 'NextGen check failed');
    }
    throw new Error('NextGen check timed out');
  },
  schedulePayment: (id: string, paymentDate?: string) => api.post(`/api/invoices/${id}/schedule-payment`, paymentDate ? { paymentDate } : {}),
  sendPaymentConfirmation: (id: string) => api.post(`/api/invoices/${id}/send-payment-confirmation`),
  reExtract: async (id: string) => {
    const res = await api.post(`/api/reprocess/${id}/re-extract`, {}, { timeout: 300000 });
    return res;
  },
  reExtractBulk: (invoiceIds: string[]) => api.post('/api/reprocess/bulk-re-extract', { invoiceIds }, { timeout: 600000 }),
  delete: (id: string) => api.delete(`/api/invoices/${id}`),
};

export const approvalApi = {
  getPending: () => api.get('/api/approvals/pending'),
};

export const paymentApi = {
  getScheduled: () => api.get('/api/payments/scheduled'),
  process: (paymentId: string) => api.post(`/api/payments/${paymentId}/process`),
};

export const exceptionApi = {
  getPending: () => api.get('/api/exceptions/pending'),
  getByInvoice: (invoiceId: string) => api.get(`/api/exceptions/invoice/${invoiceId}`),
  resolve: (exceptionId: string, resolution: string) => api.post(`/api/exceptions/${exceptionId}/resolve`, { resolution }),
  waive: (exceptionId: string, waiverReason: string) => api.post(`/api/exceptions/${exceptionId}/waive`, { waiverReason }),
};

export const paymentBatchApi = {
  getAll: () => api.get('/api/payment-batches'),
  getById: (batchId: string) => api.get(`/api/payment-batches/${batchId}`),
  create: (paymentIds: string[]) => api.post('/api/payment-batches', { paymentIds }),
  submit: (batchId: string) => api.post(`/api/payment-batches/${batchId}/submit`),
  review: (batchId: string, note?: string) => api.post(`/api/payment-batches/${batchId}/review`, { note }),
  returnForCorrection: (batchId: string, reason: string) => api.post(`/api/payment-batches/${batchId}/return`, { reason }),
  returnInvoices: (batchId: string, paymentIds: string[], reason: string) => api.post(`/api/payment-batches/${batchId}/return-invoices`, { paymentIds, reason }),
  applyBankCharge: (batchId: string, paymentId: string, amount: number, note?: string) => api.post(`/api/payment-batches/${batchId}/bank-charge`, { paymentId, amount, note }),
  removeBankCharge: (batchId: string, paymentId: string) => api.delete(`/api/payment-batches/${batchId}/bank-charge/${paymentId}`),
  endorseBillStub: (batchId: string, paymentId: string, data: { stubDate?: string; type?: string; reference?: string; originalAmount?: number; balance?: number; discount?: number; paidAmount?: number; stubFile?: File | null }) => {
    if (data.stubFile) {
      const form = new FormData();
      if (data.stubDate) form.append('stubDate', data.stubDate);
      if (data.type) form.append('type', data.type);
      if (data.reference) form.append('reference', data.reference);
      if (data.originalAmount != null) form.append('originalAmount', String(data.originalAmount));
      if (data.balance != null) form.append('balance', String(data.balance));
      if (data.discount != null) form.append('discount', String(data.discount));
      if (data.paidAmount != null) form.append('paidAmount', String(data.paidAmount));
      form.append('stubFile', data.stubFile);
      return api.post(`/api/payment-batches/${batchId}/payments/${paymentId}/endorse`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    return api.post(`/api/payment-batches/${batchId}/payments/${paymentId}/endorse`, data);
  },
  matchConfirmation: (batchId: string, data: { reference?: string; amount?: number; paidDate?: string; paymentIds?: string[] }) => api.post(`/api/payment-batches/${batchId}/match-confirmation`, data),
  markExported: (batchId: string) => api.post(`/api/payment-batches/${batchId}/export`),
  exportPerVendor: (batchId: string) => api.get(`/api/payment-batches/${batchId}/export-per-vendor`, { responseType: 'blob' }),
  exportReconciliation: (params?: { status?: string; dateFrom?: string; dateTo?: string }) => api.get('/api/payment-batches/reconciliation', { params, responseType: 'blob' }),
  process: (batchId: string, data?: { paidDate?: string; reference?: string; bankUsed?: string; remarks?: string; proof?: File | null }) => {
    if (data?.proof) {
      const form = new FormData();
      if (data.paidDate) form.append('paidDate', data.paidDate);
      if (data.reference) form.append('reference', data.reference);
      if (data.bankUsed) form.append('bankUsed', data.bankUsed);
      if (data.remarks) form.append('remarks', data.remarks);
      form.append('proof', data.proof);
      return api.post(`/api/payment-batches/${batchId}/process`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    return api.post(`/api/payment-batches/${batchId}/process`, data || {});
  },
  cancel: (batchId: string, reason: string) => api.post(`/api/payment-batches/${batchId}/cancel`, { reason }),
  getScheduledPayments: (filters?: any) => api.get('/api/payment-batches/scheduled-payments', { params: filters }),
  selectPayments: (paymentIds: string[]) => api.post('/api/payment-batches/select', { paymentIds }),
  deselectPayments: (paymentIds: string[]) => api.post('/api/payment-batches/deselect', { paymentIds }),
  setPaymentRemarks: (paymentId: string, remarks: string) => api.post(`/api/payment-batches/payments/${paymentId}/remarks`, { remarks }),
  markForPayment: (paymentId: string) => api.post(`/api/payment-batches/payments/${paymentId}/for-payment`),
  approveForPayment: (paymentId: string, note?: string) => api.post(`/api/payment-batches/payments/${paymentId}/approve-for-payment`, note ? { note } : {}),
  rejectForPayment: (paymentId: string, reason: string) => api.post(`/api/payment-batches/payments/${paymentId}/reject-for-payment`, { reason }),
  bulkApproveForPayment: (paymentIds: string[], note?: string) => api.post('/api/payment-batches/payments/bulk-approve-for-payment', { paymentIds, note }),
  approveHeld: (paymentId: string) => api.post(`/api/payment-batches/payments/${paymentId}/approve-held`),
};

export const dashboardApi = {
  getRoleDashboard: () => api.get('/api/dashboard/role'),
};

export const qbApi = {
  exportBills: (params?: { status?: string; dateFrom?: string; dateTo?: string }) =>
    api.get('/api/qb/export', { params, responseType: 'blob' }),
};

export const reportApi = {
  getOperational: () => api.get('/api/reports/operational'),
  getKPI: (params?: { brand?: string; startDate?: string; endDate?: string }) =>
    api.get('/api/reports/kpi', { params }),
  getInvoiceVolume: (params: { startDate: string; endDate: string; brand?: string }) =>
    api.get('/api/reports/invoice-volume', { params }),
  getPaymentStatus: (params?: { brand?: string; startDate?: string; endDate?: string }) =>
    api.get('/api/reports/payment-status', { params }),
  getVendorSpending: (params?: { limit?: number; brand?: string; startDate?: string; endDate?: string }) =>
    api.get('/api/reports/vendor-spending', { params }),
  getExceptionRate: (params: { startDate: string; endDate: string; brand?: string }) =>
    api.get('/api/reports/exception-rate', { params }),
  getForecast: () => api.get('/api/reports/forecast'),
  getBrands: () => api.get('/api/invoices/metadata/brands'),
};

export const vendorApi = {
  getAll: () => api.get('/api/vendors'),
  getById: (id: string) => api.get(`/api/vendors/${id}`),
  create: (data: any) => api.post('/api/vendors', data),
  update: (id: string, data: any) => api.patch(`/api/vendors/${id}`, data),
  getSuggestions: (search: string, limit?: number) =>
    api.get('/api/vendors/suggestions', { params: { search, limit } }),
  requestBankUpdate: (id: string, data: { bank_name?: string; swift_code?: string; account_number?: string; reason: string }) =>
    api.post(`/api/vendors/${id}/request-bank-update`, data),
  getBankDetails: () => api.get('/api/vendors/bank-details/masterlist'),
  updateBankDetails: (id: string, data: any) => api.patch(`/api/vendors/${id}/bank-details`, data),
};

export const auditLogApi = {
  getAll: (params?: any) => api.get('/api/audit-logs', { params }),
};

export const analyticsApi = {
  getDashboard: (days?: number) => api.get('/api/analytics/dashboard', { params: { days } }),
  getConfidence: (days?: number) => api.get('/api/analytics/confidence', { params: { days } }),
  getVendors: (days?: number) => api.get('/api/analytics/vendors', { params: { days } }),
  getErrors: (days?: number) => api.get('/api/analytics/errors', { params: { days } }),
  getTimeline: (days?: number) => api.get('/api/analytics/timeline', { params: { days } }),
  getPerformance: (days?: number) => api.get('/api/analytics/performance', { params: { days } }),
  getExtractionPolicies: () => api.get('/api/analytics/extraction-policies'),
  runExtractionBenchmark: (cases: any[]) => api.post('/api/analytics/extraction-benchmark', { cases }),
};

export const notificationApi = {
  getAll: (limit?: number) => api.get('/api/notifications', { params: { limit } }),
  getUnreadCount: () => api.get('/api/notifications/unread-count'),
  markAsRead: (id: string) => api.patch(`/api/notifications/${id}/read`),
  markAllAsRead: () => api.patch('/api/notifications/mark-all-read'),
};

export const slaAnalyticsApi = {
  getSummary: (days?: number) => api.get('/api/sla-analytics/summary', { params: { days } }),
  getCycleTimes: (days?: number) => api.get('/api/sla-analytics/cycle-times', { params: { days } }),
  getBreaches: () => api.get('/api/sla-analytics/breaches'),
  getBottlenecks: () => api.get('/api/sla-analytics/bottlenecks'),
};

export const onHoldQueueApi = {
  getAll: (status?: string, vendorId?: string) => api.get('/api/on-hold-queue', { params: { status, vendorId } }),
  getStats: () => api.get('/api/on-hold-queue/stats'),
};

export const auditExportApi = {
  exportCsv: (params?: any) => api.get('/api/audit-logs/export', { params, responseType: 'blob' }),
};

export const userApi = {
  getAll: () => api.get('/api/users'),
  getById: (id: string) => api.get(`/api/users/${id}`),
  create: (data: { name: string; email: string; role: string; password: string; active?: boolean }) =>
    api.post('/api/users', data),
  update: (id: string, data: Partial<{ name: string; email: string; role: string; password: string; active: boolean }>) =>
    api.patch(`/api/users/${id}`, data),
  delete: (id: string) => api.delete(`/api/users/${id}`),
  getRoles: () => api.get('/api/users/roles/list'),
};

export default api;
