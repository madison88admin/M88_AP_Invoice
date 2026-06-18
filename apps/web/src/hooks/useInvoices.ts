import { useQuery } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { InvoiceStatus, InvoiceCategory, InvoiceType, Invoice, PaymentTerms, OrderType } from '@ap-invoice/shared';

interface InvoiceFilters {
  status?: InvoiceStatus;
  category?: InvoiceCategory;
  type?: InvoiceType;
  brand?: string;
  brand_code?: string;
  search?: string;
}

// Mock data for when Supabase is not configured
const mockInvoices = [
  {
    id: '1',
    invoice_number: 'HK29637599',
    invoice_date: new Date('2025-12-29'),
    due_date: new Date('2026-01-28'),
    vendor_id: 'vendor-1',
    vendor: { id: 'vendor-1', name: 'Avery Dennison Paxar (China) Ltd', name_aliases: [], invoice_template_type: 'INVOICE', is_active: true },
    total_amount: 1956.17,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: OrderType.BULK,
    brand: 'Columbia Sportswear',
    brand_code: 'COLUMBIA',
    season: 'F26',
    mpo_number: 'MPO14694',
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: false,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.VALIDATION_PENDING,
    vendor_name_raw: 'Avery Dennison Paxar (China) Ltd',
    source: 'EMAIL',
    created_at: new Date('2025-12-29T10:00:00Z'),
    updated_at: new Date('2025-12-29T10:00:00Z'),
  },
  {
    id: '2',
    invoice_number: 'DC13675',
    invoice_date: new Date('2026-01-19'),
    due_date: new Date('2026-02-18'),
    vendor_id: 'vendor-2',
    vendor: { id: 'vendor-2', name: 'UPW Limited', name_aliases: [], invoice_template_type: 'INVOICE', is_active: true },
    total_amount: 174.87,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INVOICE,
    category: InvoiceCategory.YARN,
    order_type: OrderType.SAMPLE,
    brand: undefined,
    season: undefined,
    mpo_number: undefined,
    priority_pay_date: new Date('2026-01-22'),
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: true,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.PENDING_COORDINATOR,
    vendor_name_raw: 'UPW Limited',
    source: 'EMAIL',
    created_at: new Date('2026-01-19T10:00:00Z'),
    updated_at: new Date('2026-01-19T10:00:00Z'),
  },
  {
    id: '3',
    invoice_number: '100703828',
    invoice_date: new Date('2026-05-07'),
    due_date: new Date('2026-06-06'),
    vendor_id: 'vendor-3',
    vendor: { id: 'vendor-3', name: 'Avery Dennison Hong Kong B.V.', name_aliases: [], invoice_template_type: 'INVOICE', is_active: true },
    total_amount: 37.94,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: OrderType.BULK,
    brand: 'The North Face',
    brand_code: 'TNF',
    season: 'F26',
    mpo_number: 'MPO15371',
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: false,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.POSTED_TO_QB,
    qb_posted_at: new Date('2026-05-10T10:00:00Z'),
    vendor_name_raw: 'Avery Dennison Hong Kong B.V.',
    source: 'EMAIL',
    created_at: new Date('2026-05-07T10:00:00Z'),
    updated_at: new Date('2026-05-10T10:00:00Z'),
  },
  {
    id: '4',
    invoice_number: 'PCI-26018341',
    invoice_date: new Date('2026-05-08'),
    due_date: new Date('2026-06-07'),
    vendor_id: 'vendor-4',
    vendor: { id: 'vendor-4', name: 'Avery Dennison (PT. Paxar Indonesia)', name_aliases: [], invoice_template_type: 'INVOICE', is_active: true },
    total_amount: 8.62,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: OrderType.BULK,
    brand: 'The North Face',
    brand_code: 'TNF',
    season: 'F26',
    mpo_number: 'MPO15439',
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: false,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.EXCEPTION_FLAGGED,
    vendor_name_raw: 'Avery Dennison (PT. Paxar Indonesia)',
    source: 'EMAIL',
    created_at: new Date('2026-05-08T10:00:00Z'),
    updated_at: new Date('2026-05-08T10:00:00Z'),
  },
  {
    id: '5',
    invoice_number: 'F20260106',
    invoice_date: new Date('2026-01-07'),
    due_date: new Date('2026-02-06'),
    vendor_id: 'vendor-5',
    vendor: { id: 'vendor-5', name: 'Amass International Limited', name_aliases: [], invoice_template_type: 'INVOICE', is_active: true },
    total_amount: 422.25,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.INVOICE,
    category: InvoiceCategory.TRIMS,
    order_type: OrderType.BULK,
    brand: 'Prana',
    season: 'F26',
    mpo_number: 'MPO14942',
    priority_pay_date: new Date('2026-01-19'),
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: true,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.VALIDATION_PENDING,
    vendor_name_raw: 'Amass International Limited',
    source: 'EMAIL',
    created_at: new Date('2026-01-07T10:00:00Z'),
    updated_at: new Date('2026-01-07T10:00:00Z'),
  },
  {
    id: '6',
    invoice_number: 'PSP-PI-0004633',
    invoice_date: new Date('2026-01-07'),
    due_date: new Date('2026-02-06'),
    vendor_id: 'vendor-6',
    vendor: { id: 'vendor-6', name: 'Punarbhavaa Sustainable Products Pvt Ltd', name_aliases: [], invoice_template_type: 'PROFORMA', is_active: true },
    total_amount: 577.20,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.PROFORMA,
    category: InvoiceCategory.TRIMS,
    order_type: OrderType.BULK,
    brand: 'Prana',
    season: 'F26',
    mpo_number: 'MPO15309',
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: false,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.PENDING_COORDINATOR,
    vendor_name_raw: 'Punarbhavaa Sustainable Products Pvt Ltd',
    source: 'EMAIL',
    created_at: new Date('2026-01-07T10:00:00Z'),
    updated_at: new Date('2026-01-07T10:00:00Z'),
  },
  {
    id: '7',
    invoice_number: '8526250996IN202604',
    invoice_date: new Date('2026-04-30'),
    due_date: new Date('2026-05-30'),
    vendor_id: 'vendor-7',
    vendor: { id: 'vendor-7', name: 'S.F. Express (Hong Kong) Limited', name_aliases: [], invoice_template_type: 'STATEMENT', is_active: true },
    total_amount: 28.21,
    invoice_currency_original: 'HKD',
    exchange_rate_to_usd: 7.87,
    currency: 'USD',
    payment_terms: PaymentTerms.NET_30,
    invoice_type: InvoiceType.STATEMENT,
    category: InvoiceCategory.SHIPPING_FREIGHT,
    order_type: undefined,
    brand: undefined,
    season: undefined,
    mpo_number: undefined,
    bill_to_entity: 'MADISON_88_HK_LIMITED',
    bank_charges: 0,
    freight_charges: 0,
    additional_charges: 0,
    is_handwritten: false,
    priority_flag: false,
    is_urgent: false,
    is_duplicate: false,
    exception_reasons: [],
    status: InvoiceStatus.VALIDATION_PENDING,
    vendor_name_raw: 'S.F. Express (Hong Kong) Limited',
    source: 'EMAIL',
    created_at: new Date('2026-04-30T10:00:00Z'),
    updated_at: new Date('2026-04-30T10:00:00Z'),
  },
] as Invoice[];

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
        if (filters.brand) {
          filteredData = filteredData.filter(i => i.brand === filters.brand);
        }
        if (filters.brand_code) {
          filteredData = filteredData.filter(i => i.brand_code === filters.brand_code);
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
