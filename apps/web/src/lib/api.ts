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
  create: (data: any) => api.post('/api/invoices', data),
  updateStatus: (id: string, status: string) => api.patch(`/api/invoices/${id}/status`, { status }),
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/api/invoices/upload-madison', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  confirmOCR: (id: string, data: any) => api.post(`/api/invoices/${id}/confirm-ocr`, data),
  saveCorrection: (id: string, data: any) => api.post(`/api/invoices/${id}/correct-extraction`, data),
  validate: (id: string) => api.post(`/api/invoices/${id}/validate`),
  requestApproval: (id: string) => api.post(`/api/invoices/${id}/request-approval`),
  approve: (id: string, signerName: string) => api.post(`/api/invoices/${id}/approve`, { signerName }),
  reject: (id: string, reason: string) => api.post(`/api/invoices/${id}/reject`, { reason }),
  post: (id: string) => api.post(`/api/invoices/${id}/post`),
  schedulePayment: (id: string, paymentDate: string) => api.post(`/api/invoices/${id}/schedule-payment`, { paymentDate }),
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
  process: (batchId: string) => api.post(`/api/payment-batches/${batchId}/process`),
  approve: (batchId: string) => api.post(`/api/payment-batches/${batchId}/approve`),
  cancel: (batchId: string, reason: string) => api.post(`/api/payment-batches/${batchId}/cancel`, { reason }),
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

export default api;
