import { useState, useEffect, useRef } from 'react';
import { useMockData } from '../contexts/MockDataContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { CheckCircle, XCircle, Clock, ArrowLeft, Loader2, ExternalLink, FileText, Upload, X, Search, RotateCcw } from 'lucide-react';
import { MockInvoice } from '../lib/mockData';
import { invoiceApi } from '../lib/api';
import { Skeleton } from './ui/Skeleton';
import {
  orderedSignatures,
  getCoordinatorSubmissionDate,
  getPendingApprovalsForUser,
} from '../lib/approvalQueue';

type QuickViewField = {
  label: string;
  field: keyof MockInvoice | string;
  format?: 'date' | 'amount' | 'boolean' | 'percent';
};

const QUICK_VIEW_SECTIONS: Array<{ title: string; fields: QuickViewField[] }> = [
  {
    title: 'Invoice Details',
    fields: [
      { label: 'Invoice Number', field: 'invoice_number' },
      { label: 'Vendor', field: 'vendor_name' },
      { label: 'Vendor Name (OCR)', field: 'vendor_name_raw' },
      { label: 'Invoice Date', field: 'invoice_date', format: 'date' },
      { label: 'Due Date', field: 'due_date', format: 'date' },
      { label: 'Received Date', field: 'invoice_received_date', format: 'date' },
      { label: 'Amount', field: 'total_amount', format: 'amount' },
      { label: 'Currency', field: 'currency' },
      { label: 'Document Type', field: 'invoice_type' },
      { label: 'Payment Terms', field: 'payment_terms' },
      { label: 'Incoterm', field: 'incoterm' },
    ],
  },
  {
    title: 'Classification',
    fields: [
      { label: 'Brand', field: 'brand' },
      { label: 'Brand Code', field: 'brand_code' },
      { label: 'Brand Tier', field: 'brand_tier' },
      { label: 'Season', field: 'season' },
      { label: 'Order Type', field: 'order_type' },
      { label: 'Category', field: 'category' },
      { label: 'Bill To Entity', field: 'bill_to_entity' },
    ],
  },
  {
    title: 'PO & Material',
    fields: [
      { label: 'PO Number', field: 'po_number' },
      { label: 'Customer PO Number', field: 'customer_po_number' },
      { label: 'MPO Number', field: 'mpo_number' },
      { label: 'Base MPO', field: 'mpo_base_number' },
      { label: 'Order Sequence', field: 'mpo_order_sequence' },
      { label: 'Material Code', field: 'material_code' },
      { label: 'Material Name', field: 'material_name' },
      { label: 'QTY Shipped', field: 'qty_shipped' },
    ],
  },
  {
    title: 'Financial Details',
    fields: [
      { label: 'Subtotal', field: 'subtotal', format: 'amount' },
      { label: 'Tax Amount', field: 'tax_amount', format: 'amount' },
      { label: 'Discount', field: 'discount_amount', format: 'amount' },
      { label: 'Bank Charges', field: 'bank_charges', format: 'amount' },
      { label: 'Freight Charges', field: 'freight_charges', format: 'amount' },
      { label: 'Additional Charges', field: 'additional_charges', format: 'amount' },
      { label: 'Exchange Rate', field: 'exchange_rate_to_usd' },
      { label: 'Original Currency', field: 'invoice_currency_original' },
    ],
  },
  {
    title: 'Bank Details',
    fields: [
      { label: 'Beneficiary Name', field: 'beneficiary_name' },
      { label: 'Bank Name', field: 'bank_name' },
      { label: 'SWIFT Code', field: 'swift_code' },
      { label: 'Account Number', field: 'account_number' },
    ],
  },
  {
    title: 'Shipping & Dates',
    fields: [
      { label: 'Ship To', field: 'ship_to' },
      { label: 'Sold To', field: 'sold_to' },
      { label: 'Date Range Start', field: 'date_range_start', format: 'date' },
      { label: 'Date Range End', field: 'date_range_end', format: 'date' },
      { label: 'Priority Pay Date', field: 'priority_pay_date', format: 'date' },
    ],
  },
  {
    title: 'Flags & Processing',
    fields: [
      { label: 'Status', field: 'status' },
      { label: 'Current Stage', field: 'current_stage' },
      { label: 'OCR Confidence', field: 'ocr_confidence_score', format: 'percent' },
      { label: 'Handwritten', field: 'is_handwritten', format: 'boolean' },
      { label: 'Urgent', field: 'is_urgent', format: 'boolean' },
      { label: 'Priority Flag', field: 'priority_flag', format: 'boolean' },
    ],
  },
];

function formatQuickViewValue(invoice: MockInvoice, field: QuickViewField): string {
  const value = (invoice as any)[field.field];
  if (value === undefined || value === null || value === '') return 'N/A';
  if (field.format === 'boolean') return value ? 'Yes' : 'No';
  if (field.format === 'date') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }
  if (field.format === 'percent') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return `${numeric <= 1 ? numeric * 100 : numeric}%`;
  }
  if (field.format === 'amount') {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? `${invoice.currency || ''} ${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
      : String(value);
  }
  return String(value);
}

export default function ApprovalInbox() {
  const { invoices, approveInvoice, rejectInvoice } = useMockData();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<MockInvoice | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [replacingPdf, setReplacingPdf] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [openingDocument, setOpeningDocument] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returning, setReturning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [approvalFilter, setApprovalFilter] = useState<'all' | 'urgent' | 'returned' | 'issues'>('all');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setLoading(false);
  }, [invoices]);

  // Filter invoices to show only pending approvals for the current user's role
  // (shared with the sidebar badge so the counts always agree)
  const pendingApprovals = getPendingApprovalsForUser(invoices, user);

  const filteredPendingApprovals = pendingApprovals.filter((invoice) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = !query || [invoice.invoice_number, invoice.vendor_name, invoice.brand, invoice.po_number, invoice.mpo_number]
      .filter(Boolean).join(' ').toLowerCase().includes(query);
    const exceptionText = (invoice.exceptions || []).map((exception: any) => `${exception.code || ''} ${exception.message || ''}`).join(' ').toLowerCase();
    const matchesFilter = approvalFilter === 'all'
      || (approvalFilter === 'urgent' && Boolean(invoice.is_urgent || invoice.priority_flag))
      || (approvalFilter === 'returned' && (String(invoice.status).includes('RETURNED') || exceptionText.includes('return')))
      || (approvalFilter === 'issues' && (invoice.exceptions || []).some((exception: any) => ['OPEN', 'PENDING'].includes(String(exception.status).toUpperCase())));
    return matchesSearch && matchesFilter;
  });

  const getCoordinatorName = (invoice: MockInvoice) => {
    const coordinator = orderedSignatures(invoice).find(sig =>
      sig.signatory_role === 'COORDINATOR' && !!sig.signatory_name
    );
    return coordinator?.signatory_name || 'Not yet approved';
  };

  const formatSubmissionDate = (invoice: MockInvoice) => {
    const submittedAt = getCoordinatorSubmissionDate(invoice);
    return submittedAt ? new Date(submittedAt).toLocaleString() : 'Not yet submitted';
  };



  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredPendingApprovals.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const displayedInvoices = filteredPendingApprovals.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, approvalFilter]);

  useEffect(() => {
    if (!showInvoicePreview || !selectedInvoice) {
      setPdfPreviewUrl(null);
      setPdfPreviewError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setOpeningDocument(true);
    setPdfPreviewError(null);
    void invoiceApi.getDocument(selectedInvoice.id).then((response) => {
      if (cancelled) return;
      const contentType = String(response.headers['content-type'] || 'application/pdf');
      objectUrl = URL.createObjectURL(new Blob([response.data], { type: contentType }));
      setPdfPreviewUrl(objectUrl);
    }).catch((error: any) => {
      if (cancelled) return;
      const message = error?.response?.data?.message || 'The actual invoice PDF is not available for this record.';
      setPdfPreviewError(message);
    }).finally(() => {
      if (!cancelled) setOpeningDocument(false);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [showInvoicePreview, selectedInvoice]);

  const handleApprove = async () => {
    if (!selectedInvoice || !user) return;

    try {
      setApproving(true);
      await approveInvoice(selectedInvoice.id, user.name);
      showToast('Invoice approved successfully', 'success');
      setSelectedInvoice(null);
      setShowInvoicePreview(false);
    } catch (error: any) {
      console.error('Failed to approve invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to approve invoice';
      showToast(msg, 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedInvoice || !rejectReason.trim() || !user) return;

    try {
      setRejecting(true);
      await rejectInvoice(selectedInvoice.id, rejectReason);
      showToast('Invoice rejected successfully', 'success');
      setSelectedInvoice(null);
      setShowInvoicePreview(false);
      setShowRejectModal(false);
      setRejectReason('');
    } catch (error: any) {
      console.error('Failed to reject invoice:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to reject invoice';
      showToast(msg, 'error');
    } finally {
      setRejecting(false);
    }
  };

  const openInvoicePdf = (invoice: MockInvoice) => {
    setSelectedInvoice(invoice);
    setShowInvoicePreview(true);
  };

  const handleViewDocument = () => { if (selectedInvoice) openInvoicePdf(selectedInvoice); };

  const handleReturn = async () => {
    if (!selectedInvoice || !returnReason.trim() || !user) return;
    try {
      setReturning(true);
      await invoiceApi.returnForCorrection(selectedInvoice.id, returnReason.trim(), 'PURCHASING_COORDINATOR');
      showToast('Invoice returned for correction', 'success');
      setShowReturnModal(false);
      setShowInvoicePreview(false);
      setSelectedInvoice(null);
      setReturnReason('');
    } catch (error: any) {
      showToast(error?.response?.data?.message || 'Failed to return invoice', 'error');
    } finally {
      setReturning(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !selectedInvoice) return;
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); void handleApprove(); }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); setShowReturnModal(true); }
      if (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'p') {
        event.preventDefault();
        const index = filteredPendingApprovals.findIndex((invoice) => invoice.id === selectedInvoice.id);
        const nextIndex = event.key.toLowerCase() === 'n' ? index + 1 : index - 1;
        const next = filteredPendingApprovals[nextIndex];
        if (next) { setSelectedInvoice(next); setShowInvoicePreview(true); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedInvoice, filteredPendingApprovals, handleApprove]);

  const closeInvoicePreview = () => setShowInvoicePreview(false);

  const handleReplacePdf = async (file: File) => {
    if (!selectedInvoice) return;
    try {
      setReplacingPdf(true);
      await invoiceApi.uploadPdf(selectedInvoice.id, file);
      showToast('Actual invoice PDF updated', 'success');
    } catch (error: any) {
      console.error('Failed to replace invoice PDF:', error);
      const msg = error?.response?.data?.error?.message || error?.response?.data?.message || 'Failed to replace invoice PDF';
      showToast(msg, 'error');
    } finally {
      setReplacingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const getApprovalStatus = (invoice: MockInvoice) => {
    const workflowSignatures = orderedSignatures(invoice);
    if (workflowSignatures.length === 0) return 'No approvals';
    
    const approved = workflowSignatures.filter(s => s.signed_at != null).length;
    const total = workflowSignatures.length;
    const pending = workflowSignatures.find(s => !s.signed_at);
    
    if (pending) {
      return `Awaiting: ${pending.signatory_role}`;
    }
    
    return `${approved}/${total} approved`;
  };

  return (
    <div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Invoice List */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                <div className="px-4 md:px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Pending Approvals
                  </h2>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{filteredPendingApprovals.length} of {pendingApprovals.length} items</span>
                </div>
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search invoice, vendor, PO/MPO..."
                      className="w-full rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <select value={approvalFilter} onChange={(event) => setApprovalFilter(event.target.value as typeof approvalFilter)} className="rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}>
                    <option value="all">All pending</option>
                    <option value="urgent">Urgent</option>
                    <option value="returned">Returned</option>
                    <option value="issues">With issues</option>
                  </select>
                </div>
                {loading ? (
                  <div className="px-4 md:px-6 py-4 space-y-4">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-48" />
                        </div>
                        <Skeleton className="h-6 w-20 rounded-lg" />
                      </div>
                    ))}
                  </div>
                ) : filteredPendingApprovals.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <div className="inline-flex p-4 rounded-2xl mb-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
                      <CheckCircle className="h-8 w-8" style={{ color: 'var(--text-subtle)' }} strokeWidth={1.75} />
                    </div>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No pending approvals</p>
                  </div>
                ) : (
                  <>
                    <div>
                      {displayedInvoices.map((invoice, idx) => (
                      <div
                        key={invoice.id}
                        onClick={() => { setSelectedInvoice(invoice); setShowInvoicePreview(true); }}
                        className="px-4 md:px-6 py-4 cursor-pointer transition-colors"
                        style={{
                          borderTop: idx > 0 ? '1px solid var(--border-subtle)' : 'none',
                          background: selectedInvoice?.id === invoice.id ? 'var(--bg-card-hover)' : undefined,
                        }}
                        onMouseEnter={(e) => { if (selectedInvoice?.id !== invoice.id) e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                        onMouseLeave={(e) => { if (selectedInvoice?.id !== invoice.id) e.currentTarget.style.background = ''; }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-4">
                            <div className="p-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
                              <Clock className="h-5 w-5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                            </div>
                            <div>
                              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {invoice.invoice_number}
                              </p>
                              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                                {invoice.vendor_name}
                              </p>
                            <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                              Coordinator: {getCoordinatorName(invoice)}
                            </p>
                            {user?.role === 'PURCHASING_MANAGER' && (
                              <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                                Submitted by Coordinator: {formatSubmissionDate(invoice)}
                              </p>
                            )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                              {invoice.currency} {Number(invoice.total_amount).toFixed(2)}
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                              {getApprovalStatus(invoice)}
                            </p>
                            <button
                              onClick={(e) => { e.stopPropagation(); openInvoicePdf(invoice); }}
                              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
                              title="View actual invoice PDF"
                              style={{ background: 'var(--bg-elevated)', color: 'var(--accent-blue)', border: '1px solid var(--border-color)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                            >
                              <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                              PDF
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Pagination Controls */}
                  <div className="px-4 md:px-6 py-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => { if (currentPage !== 1) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      Previous
                    </button>
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
                      onMouseEnter={(e) => { if (currentPage !== totalPages) { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                      Next
                    </button>
                  </div>
                </>
                )}
              </div>
            </div>

            {/* Invoice Detail Panel */}
            {selectedInvoice && (
              <div className="lg:col-span-1">
                <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
                  <div className="px-4 md:px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Invoice Details
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.invoice_number}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Coordinator</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {getCoordinatorName(selectedInvoice)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Vendor</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.vendor_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Amount</p>
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                        {selectedInvoice.currency} {Number(selectedInvoice.total_amount).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Date</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {selectedInvoice.invoice_date
                          ? new Date(selectedInvoice.invoice_date).toLocaleDateString()
                          : 'N/A'}
                      </p>
                    </div>

                    {user?.role === 'PURCHASING_MANAGER' && (
                      <div>
                        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Coordinator Submission Date</p>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatSubmissionDate(selectedInvoice)}
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowInvoicePreview(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all text-sm font-semibold"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)', background: 'var(--bg-card-hover)' }}
                    >
                      <FileText className="h-4 w-4" />
                      View invoice details
                    </button>

                    <button type="button" onClick={handleViewDocument} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all text-sm font-semibold" style={{ borderColor: 'var(--border-color)', color: 'var(--accent-blue)', background: 'var(--bg-elevated)' }}>
                      <FileText className="h-4 w-4" /> View Actual Invoice in panel
                    </button>

                    {user && ['ACCOUNTING_ASSOCIATE', 'ACCOUNTING_SUPERVISOR', 'PURCHASING_COORDINATOR', 'IT_ADMIN'].includes(user.role) && (
                      <>
                        <button
                          type="button"
                          onClick={() => pdfInputRef.current?.click()}
                          disabled={replacingPdf}
                          title="Upload the correct PDF if the attached document is wrong"
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border transition-all text-sm font-medium"
                          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
                        >
                          {replacingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {replacingPdf ? 'Uploading...' : 'Replace PDF'}
                        </button>
                        <input
                          ref={pdfInputRef}
                          type="file"
                          accept=".pdf,application/pdf"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReplacePdf(f); }}
                        />
                      </>
                    )}

                    {/* Approval Progress */}
                    {orderedSignatures(selectedInvoice).length > 0 && (
                      <div className="pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                          Approval Progress
                        </p>
                        <div className="space-y-2">
                          {orderedSignatures(selectedInvoice)
                            .map((sig) => (
                              <div
                                key={sig.id}
                                className="flex items-center justify-between text-sm"
                              >
                                <div className="flex flex-col">
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                    {sig.signatory_name || sig.signatory_role}
                                  </span>
                                  {sig.signatory_name && (
                                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sig.signatory_role}</span>
                                  )}
                                </div>
                                <div className="flex items-center">
                                  {sig.signed_at && (
                                    <CheckCircle className="h-4 w-4 mr-1" style={{ color: 'var(--accent-lime)' }} strokeWidth={1.75} />
                                  )}
                                  {!sig.signed_at && (
                                    <Clock className="h-4 w-4 mr-1" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
                                  )}
                                  <span
                                    style={{
                                      color: sig.signed_at ? 'var(--accent-lime)' : 'var(--accent-amber)',
                                    }}
                                  >
                                    {sig.signed_at ? 'Signed' : 'Pending'}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="sticky bottom-0 z-10 -mx-1 mt-4 space-y-2 border-t p-3" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
                      <button
                        onClick={handleApprove}
                        disabled={approving}
                        className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-semibold text-sm"
                        style={approving
                          ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                          : { background: 'var(--accent-lime)', color: 'var(--bg-base)', boxShadow: '0 0 16px var(--accent-lime-glow)' }
                        }
                        onMouseEnter={(e) => { if (!approving) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
                        onMouseLeave={(e) => { if (!approving) e.currentTarget.style.background = 'var(--accent-lime)'; }}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                        {approving ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={rejecting}
                        className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                          color: 'var(--accent-red)',
                          border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)',
                        }}
                        onMouseEnter={(e) => { if (!rejecting) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 20%, transparent)'; }}
                        onMouseLeave={(e) => { if (!rejecting) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red) 10%, transparent)'; }}
                      >
                        <XCircle className="h-4 w-4 mr-2" strokeWidth={1.75} />
                        Reject
                      </button>
                      <button
                        onClick={() => setShowReturnModal(true)}
                        disabled={returning}
                        className="w-full flex items-center justify-center px-4 py-2.5 rounded-xl transition-all font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}
                      >
                        <RotateCcw className="h-4 w-4 mr-2" /> Return for correction
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
      </div>

      {/* Quick view for managers: keep approval context visible without sending
          them to the repository and making them click through another page. */}
      {showInvoicePreview && selectedInvoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-preview-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeInvoicePreview(); }}
        >
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 24px 80px rgba(0,0,0,0.3)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <h3 id="invoice-preview-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Invoice quick view</h3>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>Review the extracted invoice details without leaving Approvals. Shortcuts: A approve · R return · N/P next/previous.</p>
              </div>
              <button type="button" onClick={closeInvoicePreview} aria-label="Close invoice preview" className="rounded-lg p-2 transition-colors" style={{ color: 'var(--text-muted)' }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-6">
              <section className="mb-5 overflow-hidden rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Actual invoice PDF</h4>
                  {openingDocument && <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent-blue)' }} />}
                </div>
                <div className="min-h-[300px] bg-white">
                  {pdfPreviewUrl ? <iframe title="Actual invoice PDF" src={pdfPreviewUrl} className="h-[420px] w-full" /> : (
                    <div className="flex min-h-[300px] items-center justify-center p-6 text-center text-sm" style={{ color: pdfPreviewError ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {pdfPreviewError || (openingDocument ? 'Loading invoice PDF…' : 'No PDF preview available')}
                    </div>
                  )}
                </div>
              </section>
              <div className="space-y-4">
                {QUICK_VIEW_SECTIONS.map((section) => (
                  <section key={section.title} className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
                    <div className="px-4 py-3" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{section.title}</h4>
                    </div>
                    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                      {section.fields.map((field) => (
                        <div key={field.field} className="rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                          <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{field.label}</p>
                          <p className="mt-1 break-words text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatQuickViewValue(selectedInvoice, field)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {Array.isArray(selectedInvoice.ocr_raw_data?.extraction?.line_items) && selectedInvoice.ocr_raw_data.extraction.line_items.length > 0 && (
                <section className="mt-4 overflow-hidden rounded-xl" style={{ border: '1px solid var(--border-color)' }}>
                  <div className="px-4 py-3" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}>
                    <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Extracted Line Items ({selectedInvoice.ocr_raw_data.extraction.line_items.length})
                    </h4>
                  </div>
                  <div className="overflow-x-auto p-4">
                    <table className="w-full min-w-[620px] text-left text-xs">
                      <thead style={{ color: 'var(--text-muted)' }}>
                        <tr>
                          <th className="px-2 py-2 font-medium">#</th>
                          <th className="px-2 py-2 font-medium">Description</th>
                          <th className="px-2 py-2 font-medium">Code</th>
                          <th className="px-2 py-2 font-medium">Qty</th>
                          <th className="px-2 py-2 font-medium">Unit Price</th>
                          <th className="px-2 py-2 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInvoice.ocr_raw_data.extraction.line_items.map((line: any, index: number) => (
                          <tr key={`${line?.id || line?.line_number || index}`} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                            <td className="px-2 py-2">{line?.line_number || index + 1}</td>
                            <td className="max-w-[260px] break-words px-2 py-2">{line?.description || line?.material_name || line?.item_description || 'N/A'}</td>
                            <td className="px-2 py-2">{line?.material_code || line?.item_code || line?.code || 'N/A'}</td>
                            <td className="px-2 py-2">{line?.quantity ?? line?.qty ?? 'N/A'} {line?.unit || ''}</td>
                            <td className="px-2 py-2">{line?.unit_price ?? line?.price ?? 'N/A'}</td>
                            <td className="px-2 py-2">{line?.amount ?? line?.line_total ?? line?.total ?? 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {selectedInvoice.exceptions?.some((exception: any) => ['OPEN', 'PENDING'].includes(String(exception.status).toUpperCase())) && (
                <div className="mt-5 rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 25%, transparent)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-amber)' }}>Open issues</p>
                  <ul className="mt-2 space-y-1 text-sm" style={{ color: 'var(--text-primary)' }}>
                    {selectedInvoice.exceptions.filter((exception: any) => ['OPEN', 'PENDING'].includes(String(exception.status).toUpperCase())).map((exception: any) => (
                      <li key={exception.id || exception.code}>{exception.message || exception.description || exception.code || 'Review required'}</li>
                    ))}
                  </ul>
                </div>
              )}

              {orderedSignatures(selectedInvoice).length > 0 && (
                <div className="mt-5 rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Approval progress</p>
                  <div className="mt-3 space-y-2">
                    {orderedSignatures(selectedInvoice).map((signature) => (
                      <div key={signature.id} className="flex items-center justify-between text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>{signature.signatory_name || signature.signatory_role}</span>
                        <span className="inline-flex items-center gap-1" style={{ color: signature.signed_at ? 'var(--accent-lime)' : 'var(--accent-amber)' }}>
                          {signature.signed_at ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                          {signature.signed_at ? 'Signed' : 'Pending'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-end" style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
              <button type="button" onClick={closeInvoicePreview} className="rounded-xl px-4 py-2.5 text-sm font-medium" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>Close</button>
              <button type="button" onClick={() => setShowReturnModal(true)} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)', color: 'var(--accent-amber)', border: '1px solid color-mix(in srgb, var(--accent-amber) 28%, transparent)' }}><RotateCcw className="h-4 w-4" /> Return</button>
              <button type="button" onClick={() => setShowRejectModal(true)} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', color: 'var(--accent-red)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}><XCircle className="h-4 w-4" /> Reject</button>
              <button type="button" onClick={handleApprove} disabled={approving} className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: 'var(--accent-lime)', color: 'var(--bg-base)' }}>
                {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {approving ? 'Approving…' : 'Approve (A)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && selectedInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <h3 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Return for correction</h3>
              <textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="Explain what needs to be corrected…" className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }} rows={4} autoFocus />
              <div className="mt-4 flex justify-end gap-3">
                <button type="button" onClick={() => { setShowReturnModal(false); setReturnReason(''); }} className="px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
                <button type="button" onClick={handleReturn} disabled={!returnReason.trim() || returning} className="rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" style={{ background: 'var(--accent-amber)', color: '#fff' }}>{returning ? 'Returning…' : 'Confirm return'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="max-w-md w-full mx-4 rounded-2xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                Reject Invoice
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
                rows={4}
              />
              <div className="mt-4 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowRejectModal(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 transition-colors text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || rejecting}
                  className="px-4 py-2 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-medium"
                  style={!rejectReason.trim() || rejecting
                    ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                    : { background: 'var(--accent-red)', color: '#fff' }
                  }
                  onMouseEnter={(e) => { if (rejectReason.trim() && !rejecting) e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {rejecting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
