import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Upload, FileText, AlertCircle, CheckCircle, X, ArrowLeft } from 'lucide-react';
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
  const [vendorMatch, setVendorMatch] = useState<any>(null);
  const [requiresManualVendor, setRequiresManualVendor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
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
      setOcrResult(response.data.extraction || response.data.ocr_result);
      setVendorMatch(response.data.vendor_match);
      setRequiresManualVendor(response.data.requires_manual_vendor_assignment);

      if (response.data.requires_manual_vendor_assignment) {
        const extraction = response.data.extraction || response.data.ocr_result;
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
        total_amount: ocrResult.total_amount,
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
        bill_to_entity: ocrResult.bill_to_entity,
        is_handwritten: ocrResult.is_handwritten,
        is_urgent: ocrResult.is_urgent,
        priority_flag: ocrResult.is_urgent,
        priority_pay_date: ocrResult.priority_pay_date,
        brand: ocrResult.brand,
        brand_code: ocrResult.brand_code,
        season: ocrResult.season,
        mpo_number: ocrResult.mpo_number,
        customer_po_number: ocrResult.customer_po_number,
        bank_info: ocrResult.bank_info,
        signatures: ocrResult.signatures,
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

  const handleReset = () => {
    setFile(null);
    setOcrResult(null);
    setVendorMatch(null);
    setRequiresManualVendor(false);
    setError(null);
    setSuccess(false);
    setVendorSuggestions([]);
    setSelectedVendor('');
  };

  if (success) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 border border-gray-200">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="bg-green-100 p-4 rounded-full mb-4">
            <CheckCircle className="h-12 w-12 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Invoice Uploaded Successfully</h3>
          <p className="text-gray-500 mb-6">The invoice has been processed and added to the system.</p>
          <Link
            to="/"
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm p-8 border border-gray-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Link to="/" className="mr-4 text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <h2 className="text-2xl font-bold text-gray-900">Upload Invoice</h2>
        </div>
      </div>

      {!ocrResult ? (
        <>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-primary-500 transition-colors cursor-pointer"
          >
            <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">
              Drag and drop your invoice PDF or image here, or click to browse
            </p>
            <p className="text-sm text-gray-400">Supported formats: PDF, JPG, PNG</p>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="mt-4 inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Browse Files
            </label>
          </div>

          {file && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg flex items-center justify-between">
              <div className="flex items-center">
                <FileText className="h-5 w-5 text-gray-400 mr-3" />
                <span className="text-sm font-medium text-gray-900">{file.name}</span>
                <span className="text-xs text-gray-500 ml-2">({(file.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button
                onClick={() => setFile(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-50 rounded-lg flex items-start">
              <AlertCircle className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {file && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="mt-6 w-full py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {uploading ? 'Processing...' : 'Process Invoice'}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">OCR Extraction Results</h3>
            <p className="text-sm text-blue-700">Review and confirm the extracted information below.</p>
          </div>

          {ocrResult.is_handwritten && (
            <div className="p-4 bg-orange-50 rounded-lg flex items-start">
              <AlertCircle className="h-5 w-5 text-orange-600 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-orange-900">Handwritten Document Detected</p>
                <p className="text-sm text-orange-700">This invoice was flagged as handwritten. Manual data entry by Purchasing Coordinator may be required.</p>
              </div>
            </div>
          )}

          {ocrResult.is_urgent && (
            <div className="p-4 bg-red-50 rounded-lg flex items-start">
              <AlertCircle className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Urgent Payment Flag Detected</p>
                <p className="text-sm text-red-700">
                  {ocrResult.priority_pay_date 
                    ? `Priority payment requested by ${new Date(ocrResult.priority_pay_date).toLocaleDateString()}`
                    : 'Priority payment requested - immediate attention required'}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number</label>
              <input
                type="text"
                value={ocrResult.invoice_number}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
              <input
                type="date"
                value={ocrResult.invoice_date}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                value={ocrResult.due_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, due_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Received Date</label>
              <input
                type="date"
                value={ocrResult.invoice_received_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_received_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name</label>
              <input
                type="text"
                value={ocrResult.vendor_name}
                onChange={(e) => setOcrResult({ ...ocrResult, vendor_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.total_amount}
                onChange={(e) => setOcrResult({ ...ocrResult, total_amount: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Original Currency</label>
              <input
                type="text"
                value={ocrResult.invoice_currency_original || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_currency_original: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Exchange Rate to USD</label>
              <input
                type="number"
                step="0.0001"
                value={ocrResult.exchange_rate_to_usd || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, exchange_rate_to_usd: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <select
                value={ocrResult.payment_terms}
                onChange={(e) => setOcrResult({ ...ocrResult, payment_terms: e.target.value as PaymentTerms })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Incoterm</label>
              <input
                type="text"
                value={ocrResult.incoterm || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, incoterm: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Type</label>
              <select
                value={ocrResult.invoice_type}
                onChange={(e) => setOcrResult({ ...ocrResult, invoice_type: e.target.value as InvoiceType })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                {Object.values(InvoiceType).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={ocrResult.category}
                onChange={(e) => setOcrResult({ ...ocrResult, category: e.target.value as InvoiceCategory })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                {Object.values(InvoiceCategory).map((category: InvoiceCategory) => (
                  <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bill To Entity</label>
              <select
                value={ocrResult.bill_to_entity || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, bill_to_entity: e.target.value as BillToEntity })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">Select Entity</option>
                {Object.values(BillToEntity).map((entity) => (
                  <option key={entity} value={entity}>{entity.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range Start</label>
              <input
                type="date"
                value={ocrResult.date_range_start || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, date_range_start: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range End</label>
              <input
                type="date"
                value={ocrResult.date_range_end || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, date_range_end: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority Pay Date</label>
              <input
                type="date"
                value={ocrResult.priority_pay_date || ''}
                onChange={(e) => setOcrResult({ ...ocrResult, priority_pay_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.bank_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, bank_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Freight Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.freight_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, freight_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Charges</label>
              <input
                type="number"
                step="0.01"
                value={ocrResult.additional_charges}
                onChange={(e) => setOcrResult({ ...ocrResult, additional_charges: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={''}
              onChange={() => {}}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-primary-500 focus:border-primary-500"
              rows={2}
            />
          </div>

          {requiresManualVendor && (
            <div className="p-4 bg-yellow-50 rounded-lg">
              <label className="block text-sm font-medium text-yellow-900 mb-2">
                Vendor Not Found - Please Select from Suggestions
              </label>
              <select
                value={selectedVendor}
                onChange={(e) => setSelectedVendor(e.target.value)}
                className="w-full px-3 py-2 border border-yellow-300 rounded-md focus:outline-none focus:ring-yellow-500 focus:border-yellow-500"
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
            <div className="p-4 bg-red-50 rounded-lg flex items-start">
              <AlertCircle className="h-5 w-5 text-red-600 mr-3 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={handleConfirm}
              disabled={uploading || (requiresManualVendor && !selectedVendor)}
              className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {uploading ? 'Confirming...' : 'Confirm & Create Invoice'}
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
