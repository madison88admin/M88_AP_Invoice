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
  create: (data: any) => api.post('/api/invoices', data),
  updateStatus: (id: string, status: string) => api.patch(`/api/invoices/${id}/status`, { status }),
  update: (id: string, data: any) => api.patch(`/api/invoices/${id}`, data),
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
      const pollRes = await api.get(`/api/invoices/upload-jobs/${jobId}`, { timeout: 10000 });
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
  post: (id: string, bypassVarianceCheck: boolean = false) => api.post(`/api/invoices/${id}/post`, { bypassVarianceCheck }),
  releaseHold: (id: string) => api.post(`/api/invoices/${id}/release-hold`),
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
  schedulePayment: (id: string, paymentDate: string) => api.post(`/api/invoices/${id}/schedule-payment`, { paymentDate }),
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
  markExported: (batchId: string) => api.post(`/api/payment-batches/${batchId}/export`),
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
};

export const dashboardApi = {
  getRoleDashboard: () => api.get('/api/dashboard/role'),
};

export const reportApi = {
  getOperational: () => api.get('/api/reports/operational'),
};

export const vendorApi = {
  getAll: () => api.get('/api/vendors'),
  getById: (id: string) => api.get(`/api/vendors/${id}`),
  create: (data: any) => api.post('/api/vendors', data),
  update: (id: string, data: any) => api.patch(`/api/vendors/${id}`, data),
  getSuggestions: (search: string, limit?: number) => 
    api.get('/api/vendors/suggestions', { params: { search, limit } }),
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
