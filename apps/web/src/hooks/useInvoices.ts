import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { InvoiceStatus, InvoiceCategory, InvoiceType, Invoice, PaymentTerms, MadisonEntity } from '@ap-invoice/shared';

interface InvoiceFilters {
  status?: InvoiceStatus;
  category?: InvoiceCategory;
  type?: InvoiceType;
  search?: string;
}

// Mock data for when Supabase is not configured
const mockInvoices: Invoice[] = [
  {
    id: '1',
    invoice_number: 'INV-2024-001',
    invoice_date: new Date('2024-01-15'),
    invoice_due_date: new Date('2024-02-15'),
    vendor_id: 'vendor-1',
    vendor: { id: 'vendor-1', name: 'Acme Corporation', name_aliases: [], expected_template: InvoiceType.INV, currency: 'USD' },
    amount: 5000,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INV,
    category: InvoiceCategory.OTHER,
    bill_to_name: 'Madison 88 Ltd',
    bill_to_address: '123 Business St, Hong Kong',
    bill_to_entity: MadisonEntity.MADISON_88_HONG_KONG_LIMITED,
    bank_charges: 0,
    shipping_charges: 0,
    customs_charges: 0,
    documentation_charges: 0,
    surcharges: 0,
    is_handwritten: false,
    is_priority: false,
    status: InvoiceStatus.PENDING_VALIDATION,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
  },
  {
    id: '2',
    invoice_number: 'INV-2024-002',
    invoice_date: new Date('2024-01-16'),
    invoice_due_date: new Date('2024-02-16'),
    vendor_id: 'vendor-2',
    vendor: { id: 'vendor-2', name: 'Tech Solutions Inc', name_aliases: [], expected_template: InvoiceType.INV, currency: 'USD' },
    amount: 7500,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_60,
    invoice_type: InvoiceType.INV,
    category: InvoiceCategory.OTHER,
    bill_to_name: 'Madison 88 Ltd',
    bill_to_address: '123 Business St, Hong Kong',
    bill_to_entity: MadisonEntity.MADISON_88_HONG_KONG_LIMITED,
    bank_charges: 0,
    shipping_charges: 0,
    customs_charges: 0,
    documentation_charges: 0,
    surcharges: 0,
    is_handwritten: false,
    is_priority: true,
    status: InvoiceStatus.PENDING_APPROVAL,
    created_at: new Date('2024-01-16T10:00:00Z'),
    updated_at: new Date('2024-01-16T10:00:00Z'),
  },
  {
    id: '3',
    invoice_number: 'INV-2024-003',
    invoice_date: new Date('2024-01-10'),
    invoice_due_date: new Date('2024-02-10'),
    vendor_id: 'vendor-3',
    vendor: { id: 'vendor-3', name: 'Global Supplies', name_aliases: [], expected_template: InvoiceType.INV, currency: 'EUR' },
    amount: 3200,
    currency: 'EUR',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INV,
    category: InvoiceCategory.OTHER,
    bill_to_name: 'Madison 88 Ltd',
    bill_to_address: '123 Business St, Hong Kong',
    bill_to_entity: MadisonEntity.MADISON_88_HONG_KONG_LIMITED,
    bank_charges: 0,
    shipping_charges: 0,
    customs_charges: 0,
    documentation_charges: 0,
    surcharges: 0,
    is_handwritten: false,
    is_priority: false,
    status: InvoiceStatus.PAID,
    created_at: new Date('2024-01-10T10:00:00Z'),
    updated_at: new Date('2024-01-10T10:00:00Z'),
  },
  {
    id: '4',
    invoice_number: 'INV-2024-004',
    invoice_date: new Date('2024-01-17'),
    invoice_due_date: new Date('2024-02-17'),
    vendor_id: 'vendor-4',
    vendor: { id: 'vendor-4', name: 'Local Services', name_aliases: [], expected_template: InvoiceType.INV, currency: 'USD' },
    amount: 1500,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INV,
    category: InvoiceCategory.OTHER,
    bill_to_name: 'Madison 88 Ltd',
    bill_to_address: '123 Business St, Hong Kong',
    bill_to_entity: MadisonEntity.MADISON_88_HONG_KONG_LIMITED,
    bank_charges: 0,
    shipping_charges: 0,
    customs_charges: 0,
    documentation_charges: 0,
    surcharges: 0,
    is_handwritten: true,
    is_priority: true,
    status: InvoiceStatus.EXCEPTION,
    created_at: new Date('2024-01-17T10:00:00Z'),
    updated_at: new Date('2024-01-17T10:00:00Z'),
  },
  {
    id: '5',
    invoice_number: 'INV-2024-005',
    invoice_date: new Date('2024-01-18'),
    invoice_due_date: new Date('2024-02-18'),
    vendor_id: 'vendor-5',
    vendor: { id: 'vendor-5', name: 'Digital Agency', name_aliases: [], expected_template: InvoiceType.INV, currency: 'USD' },
    amount: 8900,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INV,
    category: InvoiceCategory.OTHER,
    bill_to_name: 'Madison 88 Ltd',
    bill_to_address: '123 Business St, Hong Kong',
    bill_to_entity: MadisonEntity.MADISON_88_HONG_KONG_LIMITED,
    bank_charges: 0,
    shipping_charges: 0,
    customs_charges: 0,
    documentation_charges: 0,
    surcharges: 0,
    is_handwritten: false,
    is_priority: false,
    status: InvoiceStatus.PENDING_APPROVAL,
    created_at: new Date('2024-01-18T10:00:00Z'),
    updated_at: new Date('2024-01-18T10:00:00Z'),
  },
];

export function useInvoices(filters: InvoiceFilters = {}, page: number = 1, limit: number = 20) {
  return useQuery({
    queryKey: ['invoices', filters, page, limit],
    queryFn: async (): Promise<{ data: Invoice[]; total: number }> => {
      // Return mock data if Supabase is not configured
      if (!isSupabaseConfigured || !supabase) {
        // Apply filters to mock data
        let filteredData = [...mockInvoices];

        if (filters.status) {
          filteredData = filteredData.filter(i => i.status === filters.status);
        }
        if (filters.category) {
          filteredData = filteredData.filter(i => i.category === filters.category);
        }
        if (filters.type) {
          filteredData = filteredData.filter(i => i.invoice_type === filters.type);
        }
        if (filters.search) {
          filteredData = filteredData.filter(i =>
            i.vendor?.name?.toLowerCase().includes(filters.search!.toLowerCase())
          );
        }

        // Apply pagination
        const from = (page - 1) * limit;
        const to = from + limit;
        const paginatedData = filteredData.slice(from, to);

        return {
          data: paginatedData,
          total: filteredData.length,
        };
      }

      let query = supabase
        .from('invoices')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.category) {
        query = query.eq('category', filters.category);
      }
      if (filters.type) {
        // Map InvoiceType to category or add type field if needed
        query = query.eq('category', filters.type);
      }
      if (filters.search) {
        query = query.ilike('vendor_name', `%${filters.search}%`);
      }

      // Apply pagination
      const from = (page - 1) * limit;
      const to = from + limit - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data: data as Invoice[] || [],
        total: count || 0,
      };
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}
