import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, AlertCircle, CheckCircle, X, ArrowLeft, Save } from 'lucide-react';
import { invoiceApi, vendorApi } from '../lib/api';
import { InvoiceType, InvoiceCategory, PaymentTerms, BillToEntity } from '@ap-invoice/shared';

interface OCRResult {
  invoice_number: string;
  invoice_date: string;
  due_date?: string;
  invoice_received_date?: string;
  date_range_start?: string;
  date_range_end?: string;
  vendor_name: string;
  total_amount: number;
  currency: string;
  settlement_currency?: string;
  invoice_currency_original?: string;
  needs_currency_confirmation?: boolean;
  exchange_rate_to_usd?: number;
  payment_terms: PaymentTerms;
  incoterm?: string;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  bank_charges: number;
  freight_charges: number;
  additional_charges: number;
  invoice_type: InvoiceType;
  category: InvoiceCategory;
  bill_to_entity?: BillToEntity;
  ship_to?: string;
  sold_to?: string;
  is_handwritten: boolean;
  is_urgent: boolean;
  priority_pay_date?: string;
  brand?: string;
  brand_code?: string;
  season?: string;
  mpo_number?: string;
  customer_po_number?: string;
  bank_info: {
    bank_name?: string;
    swift_code?: string;
    account_usd?: string;
    account_hkd?: string;
    account_eur?: string;
    account_idr?: string;
    account_inr?: string;
    account_vnd?: string;
    account_name?: string;
    bank_address?: string;
    intermediary_bank_name?: string;
    intermediary_bank_swift?: string;
  };
  signatures: Array<{
    signatory_name: string;
    signed_at?: string;
    signatory_role: string;
    signature_type: string;
  }>;
  order_type?: string;
  ocr_confidence_score?: number;
  raw_data?: any;
  po_validation?: any;
  line_items?: any[];
  source_document_type?: string;
  structured_source_format?: string;
  document_layout_fingerprint?: string;
  document_classification?: { document_type: string; confidence: number; payable_candidate: boolean; reasons: string[] };
  amount_resolution_debug?: {
    method: string;
    confidence: number;
    score: number | null;
    topCandidates: Array<{ amount: number; label: string; score: number; page: number }>;
    internalLineItems?: Array<{ quantity: number; unitPrice: number; extendedPrice: number; rawLine: string }>;
    internalLineItemSum?: number;
  };
}

export default function InvoiceUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [originalOcrResult, setOriginalOcrResult] = useState<OCRResult | null>(null);
  const [vendorMatch, setVendorMatch] = useState<any>(null);
  const [requiresManualVendor, setRequiresManualVendor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const [vendorSuggestions, setVendorSuggestions] = useState<any[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>('');

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setOcrResult(null);
    setVendorMatch(null);
    setRequiresManualVendor(false);
    setSuccess(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const response = await invoiceApi.upload(file);
      const extraction = response.data.extraction || response.data.ocr_result;
      setOcrResult(extraction);
      setOriginalOcrResult(extraction ? JSON.parse(JSON.stringify(extraction)) : null);
      setVendorMatch(response.data.vendor_match);
      setRequiresManualVendor(response.data.requires_manual_vendor_assignment);
      setCorrectionSaved(false);

      if (response.data.requires_manual_vendor_assignment) {
        const suggestions = await vendorApi.getSuggestions(extraction?.vendor_name);
        setVendorSuggestions(suggestions.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to process invoice');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!ocrResult) return;
    if (ocrResult.document_classification && !ocrResult.document_classification.payable_candidate &&
        !window.confirm(`This file was classified as ${ocrResult.document_classification.document_type}. Save it as an invoice record anyway?`)) {
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const finalVendorId = requiresManualVendor ? selectedVendor : vendorMatch?.vendor_id;

      if (!finalVendorId) {
        setError('Please select a vendor');
        setUploading(false);
        return;
      }

      await invoiceApi.confirmOCR('temp', {
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date,
        invoice_received_date: ocrResult.invoice_received_date,
        date_range_start: ocrResult.date_range_start,
        date_range_end: ocrResult.date_range_end,
        vendor_id: finalVendorId,
        vendor_name_raw: ocrResult.vendor_name,
        total_amount: ocrResult.total_amount,
        invoice_currency_original: ocrResult.invoice_currency_original,
        exchange_rate_to_usd: ocrResult.exchange_rate_to_usd,
        currency: ocrResult.currency,
        payment_terms: String(ocrResult.payment_terms) as PaymentTerms,
        incoterm: ocrResult.incoterm,
        subtotal: ocrResult.subtotal,
        tax_amount: ocrResult.tax_amount,
        discount_amount: ocrResult.discount_amount,
        bank_charges: ocrResult.bank_charges,
        freight_charges: ocrResult.freight_charges,
        additional_charges: ocrResult.additional_charges,
        ship_to: ocrResult.ship_to,
        sold_to: ocrResult.sold_to,
        invoice_type: ocrResult.invoice_type,
        category: ocrResult.category,
        order_type: ocrResult.order_type,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bill_to_entity: ocrResult.bill_to_entity,
        is_handwritten: ocrResult.is_handwritten,
        is_urgent: ocrResult.is_urgent,
        priority_flag: ocrResult.is_urgent,
        priority_pay_date: ocrResult.priority_pay_date,
        bank_info: ocrResult.bank_info || (ocrResult as any).bank_details,
        signatures: ocrResult.signatures,
        ocr_confidence_score: ocrResult.ocr_confidence_score,
        ocr_raw_data: ocrResult.raw_data || ocrResult,
        po_validation: ocrResult.po_validation,
        qty_shipped: (ocrResult as any).qty_shipped,
        line_items: ocrResult.line_items,
        source_document_type: ocrResult.source_document_type,
        structured_source_format: ocrResult.structured_source_format,
        document_layout_fingerprint: ocrResult.document_layout_fingerprint,
      });

      setSuccess(true);
      setFile(null);
      setOcrResult(null);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to confirm invoice');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (!ocrResult || !originalOcrResult) return;

    setUploading(true);
    setError(null);

    try {
      const originalFields = {
        vendor_name: originalOcrResult.vendor_name,
        invoice_number: originalOcrResult.invoice_number,
        invoice_date: originalOcrResult.invoice_date,
        due_date: originalOcrResult.due_date,
        total_amount: originalOcrResult.total_amount,
        currency: originalOcrResult.currency,
        invoice_currency_original: originalOcrResult.invoice_currency_original,
        payment_terms: originalOcrResult.payment_terms,
        incoterm: originalOcrResult.incoterm,
        invoice_type: originalOcrResult.invoice_type,
        category: originalOcrResult.category,
        bill_to_entity: originalOcrResult.bill_to_entity,
        ship_to: originalOcrResult.ship_to,
        sold_to: originalOcrResult.sold_to,
        brand: originalOcrResult.brand,
        brand_code: originalOcrResult.brand_code,
        season: originalOcrResult.season,
        mpo_number: originalOcrResult.mpo_number,
        customer_po_number: originalOcrResult.customer_po_number,
      };

      const correctedFields = {
        vendor_name: ocrResult.vendor_name,
        invoice_number: ocrResult.invoice_number,
        invoice_date: ocrResult.invoice_date,
        due_date: ocrResult.due_date,
        total_amount: ocrResult.total_amount,
        currency: ocrResult.currency,
        invoice_currency_original: ocrResult.invoice_currency_original,
        payment_terms: ocrResult.payment_terms,
        incoterm: ocrResult.incoterm,
        invoice_type: ocrResult.invoice_type,
        category: ocrResult.category,
        bill_to_entity: ocrResult.bill_to_entity,
        ship_to: ocrResult.ship_to,
        sold_to: ocrResult.sold_to,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
      };

      await invoiceApi.saveStandaloneCorrection({
        vendor_name: ocrResult.vendor_name,
        raw_text: (ocrResult as any).raw_text || (originalOcrResult as any).raw_text || '',
        original_fields: originalFields,
        corrected_fields: correctedFields,
        note: 'Manual correction from upload review',
        layout_fingerprint: ocrResult.document_layout_fingerprint,
      });

      setCorrectionSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error?.message || err?.message || 'Failed to save correction');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setOcrResult(null);
    setOriginalOcrResult(null);
    setVendorMatch(null);
    setRequiresManualVendor(false);
    setError(null);
    setSuccess(false);
    setCorrectionSaved(false);
    setVendorSuggestions([]);
    setSelectedVendor('');
  };

  if (success) {
    return (
      <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="p-4 rounded-full mb-4" style={{ background: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
            <CheckCircle className="h-12 w-12" style={{ color: 'var(--accent-green)' }} strokeWidth={1.75} />
          </div>
          <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Invoice Uploaded Successfully</h3>
          <p className="mb-6" style={{ color: 'var(--text-muted)' }}>The invoice has been processed and added to the system.</p>
          <Link
            to="/"
            className="px-6 py-2.5 rounded-xl transition-colors text-sm font-medium"
            style={{ background: 'var(--accent-purple)', color: '#fff' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-purple)'; }}
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-8" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Link to="/" className="mr-4 transition-colors" style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
          </Link>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Upload Invoice</h2>
        </div>
      </div>

      {!ocrResult ? (
        <>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer"
            style={{ borderColor: 'var(--border-color)', background: 'var(--bg-elevated)' }}
          >
            <Upload className="h-12 w-12 mx-auto mb-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
            <p className="mb-2" style={{ color: 'var(--text-secondary)' }}>
              Drag and drop an invoice PDF, image, XML, or UBL file here, or click to browse
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Supported formats: PDF, JPG, PNG, XML, UBL</p>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.xml,.ubl,application/xml,text/xml"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="mt-4 inline-block px-4 py-2 rounded-xl transition-colors cursor-pointer text-sm font-medium"
              style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
            >
              Browse Files
            </label>
          </div>

          {file && (
            <div className="mt-6 p-4 rounded-xl flex items-center justify-between" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center">
                <FileText className="h-5 w-5 mr-3" style={{ color: 'var(--text-muted)' }} strokeWidth={1.75} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</span>
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button
                onClick={() => setFile(null)}
                className="transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 rounded-xl flex items-start" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
              <AlertCircle className="h-5 w-5 mr-3 mt-0.5" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
              <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>
            </div>
          )}

          {file && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="mt-6 w-full py-3 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-semibold"
              style={uploading
                ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                : { background: 'var(--accent-purple)', color: '#fff' }
              }
              onMouseEnter={(e) => { if (!uploading) e.currentTarget.style.background = 'var(--accent-purple-hover)'; }}
              onMouseLeave={(e) => { if (!uploading) e.currentTarget.style.background = 'var(--accent-purple)'; }}
            >
              {uploading ? 'Processing...' : 'Process Invoice'}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }}>
            <h3 className="font-semibold mb-2" style={{ color: 'var(--accent-purple)' }}>OCR Extraction Results</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Review and confirm the extracted information below.</p>
          </div>

          {ocrResult.document_classification && (
            <div className="p-4 rounded-xl flex items-start" style={{
              background: ocrResult.document_classification.payable_candidate ? 'color-mix(in srgb, var(--accent-green) 10%, transparent)' : 'color-mix(in srgb, var(--accent-amber) 10%, transparent)',
              border: `1px solid ${ocrResult.document_classification.payable_candidate ? 'var(--accent-green)' : 'var(--accent-amber)'}`,
            }}>
              <AlertCircle className="h-5 w-5 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium">Document classified as {ocrResult.document_classification.document_type.replace(/_/g, ' ')} ({ocrResult.document_classification.confidence}%)</p>
                {!ocrResult.document_classification.payable_candidate && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>This is normally a supporting document and should not proceed to payment unless Purchasing confirms it.</p>}
              </div>
            </div>
          )}

          {ocrResult.is_handwritten && (
            <div className="p-4 rounded-xl flex items-start" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
              <AlertCircle className="h-5 w-5 mr-3 mt-0.5" style={{ color: 'var(--accent-amber)' }} strokeWidth={1.75} />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Handwritten Document Detected</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>This invoice was flagged as handwritten. Manual data entry by Purchasing Coordinator may be required.</p>
              </div>
            </div>
          )}

          {ocrResult.is_urgent && (
            <div className="p-4 rounded-xl flex items-start" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
              <AlertCircle className="h-5 w-5 mr-3 mt-0.5" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--accent-red)' }}>Urgent Payment Flag Detected</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {ocrResult.priority_pay_date 
                    ? `Priority payment requested by ${new Date(ocrResult.priority_pay_date).toLocaleDateString()}`
                    : 'Priority payment requested - immediate attention required'}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Number</label>
              <input
                type="text"
                value={ocrResult.invoice_number}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_number: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Date</label>
              <input
                type="date"
                value={ocrResult.invoice_date}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Due Date</label>
              <input
                type="date"
                value={ocrResult.due_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, due_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Received Date</label>
              <input
                type="date"
                value={ocrResult.invoice_received_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_received_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Vendor Name</label>
              <input
                type="text"
                value={ocrResult.vendor_name}
                onChange={(e) => setOcrResult({ ...ocrResult, vendor_name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.total_amount}
                onChange={(e) => setOcrResult({ ...ocrResult, total_amount: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Original Currency</label>
              <input
                type="text"
                value={ocrResult.invoice_currency_original || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_currency_original: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Exchange Rate to USD</label>
              <input
                type="number"
                step="0.0001"
                value={ocrResult.exchange_rate_to_usd || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, exchange_rate_to_usd: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Payment Terms</label>
              <select
                value={ocrResult.payment_terms}
                onChange={(e) => setOcrResult({ ...ocrResult, payment_terms: e.target.value as PaymentTerms })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="">Select payment terms...</option>
                <option value="NET_30">NET 30</option>
                <option value="NET_60">NET 60</option>
                <option value="NET_90">NET 90</option>
                <option value="PAYMENT_IN_ADVANCE">Payment in Advance</option>
                <option value="TT_100_BEFORE_SHIPMENT">T/T 100% Before Shipment</option>
                <option value="PBS">PBS</option>
                <option value="ARD">ARD</option>
                <option value="CHEQUE_30">Cheque 30</option>
                <option value="SPLIT_50_50">Split 50/50</option>
                <option value="PREPAID">Prepaid</option>
                <option value="COD">COD</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Incoterm</label>
              <input
                type="text"
                value={ocrResult.incoterm || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, incoterm: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Invoice Type</label>
              <select
                value={ocrResult.invoice_type}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_type: e.target.value as InvoiceType })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                {Object.values(InvoiceType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Category</label>
              <select
                value={ocrResult.category}
                onChange={(e) => setOcrResult({ ...ocrResult, category: e.target.value as InvoiceCategory })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                {Object.values(InvoiceCategory).map((category: InvoiceCategory) => (
                  <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bill To Entity</label>
              <select
                value={ocrResult.bill_to_entity || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, bill_to_entity: e.target.value as BillToEntity })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              >
                <option value="">Select Entity</option>
                {Object.values(BillToEntity).map((entity) => (
                  <option key={entity} value={entity}>{entity.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Date Range Start</label>
              <input
                type="date"
                value={ocrResult.date_range_start || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, date_range_start: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Date Range End</label>
              <input
                type="date"
                value={ocrResult.date_range_end || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, date_range_end: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Priority Pay Date</label>
              <input
                type="date"
                value={ocrResult.priority_pay_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, priority_pay_date: e.target.value })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Bank Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.bank_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, bank_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Freight Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.freight_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, freight_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Additional Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.additional_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, additional_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Notes</label>
            <textarea
              value={''}
              onChange={() => {}}
              className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)' }}
              rows={2}
            />
          </div>

          {requiresManualVendor && (
            <div className="p-4 rounded-xl" style={{ background: 'color-mix(in srgb, var(--accent-amber) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)' }}>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--accent-amber)' }}>
                Vendor Not Found - Please Select from Suggestions
              </label>
              <select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
                className="w-full px-3 py-2 rounded-xl focus:outline-none text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid color-mix(in srgb, var(--accent-amber) 20%, transparent)', color: 'var(--text-primary)' }}
              >
                <option value="">Select a vendor...</option>
                {vendorSuggestions.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name} (Confidence: {(vendor.confidence * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl flex items-start" style={{ background: 'color-mix(in srgb, var(--accent-red) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-red) 20%, transparent)' }}>
              <AlertCircle className="h-5 w-5 mr-3 mt-0.5" style={{ color: 'var(--accent-red)' }} strokeWidth={1.75} />
              <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleConfirm}
              disabled={uploading || (requiresManualVendor && !selectedVendor)}
              className="flex-1 py-3 rounded-xl transition-colors disabled:cursor-not-allowed text-sm font-semibold"
              style={uploading || (requiresManualVendor && !selectedVendor)
                ? { background: 'var(--bg-card-hover)', color: 'var(--text-muted)', cursor: 'not-allowed' }
                : { background: 'var(--accent-lime)', color: 'var(--bg-base)' }
              }
              onMouseEnter={(e) => { if (!(uploading || (requiresManualVendor && !selectedVendor))) e.currentTarget.style.background = 'var(--accent-lime-hover)'; }}
              onMouseLeave={(e) => { if (!(uploading || (requiresManualVendor && !selectedVendor))) e.currentTarget.style.background = 'var(--accent-lime)'; }}
            >
              {uploading ? 'Confirming...' : 'Confirm & Create Invoice'}
            </button>
            <button
              onClick={handleSaveCorrection}
              disabled={uploading || correctionSaved || !originalOcrResult}
              className="px-6 py-3 rounded-xl transition-colors disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
              style={uploading || correctionSaved || !originalOcrResult
                ? { background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', cursor: 'not-allowed' }
                : { background: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', color: 'var(--accent-purple)', border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)' }
              }
              onMouseEnter={(e) => { if (!(uploading || correctionSaved || !originalOcrResult)) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-purple) 20%, transparent)'; }}
              onMouseLeave={(e) => { if (!(uploading || correctionSaved || !originalOcrResult)) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-purple) 10%, transparent)'; }}
            >
              {correctionSaved ? (
                <>
                  <CheckCircle className="h-4 w-4" strokeWidth={1.75} /> Saved
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" strokeWidth={1.75} /> Save Correction
                </>
              )}
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-3 transition-colors text-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
