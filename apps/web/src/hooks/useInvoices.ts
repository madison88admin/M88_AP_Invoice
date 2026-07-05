import { useQuery } from '@tanstack/react-query';
import { InvoiceStatus, InvoiceCategory, InvoiceType, Invoice } from '@ap-invoice/shared';
import { invoiceApi } from '../lib/api';

interface InvoiceFilters {
  status?: InvoiceStatus;
  category?: InvoiceCategory;
  type?: InvoiceType;
  brand?: string;
  brand_code?: string;
  search?: string;
}

export function useInvoices(filters: InvoiceFilters = {}, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ['invoices', filters, page, limit],
    queryFn: async (): Promise<{ data: Invoice[]; total: number }> => {
      const response = await invoiceApi.getAll({ ...filters, page, limit });
      return {
        data: (response.data || []) as Invoice[],
        total: response.headers['x-total-count']
          ? Number(response.headers['x-total-count'])
          : (response.data || []).length,
      };
    },
    refetchInterval: 30000,
  });
}
