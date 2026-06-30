import { useState, useCallback } from 'react';
import { Upload, FileText, X, Sparkles, CheckCircle, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { invoiceApi } from '../lib/api';

interface UploadInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadInvoiceModal({ isOpen, onClose }: UploadInvoiceModalProps) {
  console.log('UploadInvoiceModal render, isOpen:', isOpen);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [poValidation, setPoValidation] = useState<any>(null);
  const [consensus, setConsensus] = useState<any>(null);
  const [requiresManualVendorAssignment, setRequiresManualVendorAssignment] = useState(false);
  const [formData, setFormData] = useState({
    vendorName: '',
    invoiceNumber: '',
    invoiceDate: '',
    dueDate: '',
    amount: '',
    currency: 'USD',
    category: '',
    brand: '',
    brandTier: '' as '' | 'TOP_10' | 'OTHER',
    season: '',
    orderType: '' as '' | 'BULK' | 'SMS' | 'SAMPLE',
    poNumber: '',
    mpoNumber: '',
    qtyShipped: '',
    paymentTerms: '',
    bankName: '',
    swiftCode: '',
    accountNumber: '',
    notes: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
  });

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    console.log('[DEBUG] File selected:', selectedFile.name, selectedFile.size);
    setFile(selectedFile);
    console.log('[DEBUG] AI extraction enabled, starting...');
    setIsExtracting(true);
    try {
      console.log('[DEBUG] Calling invoiceApi.upload...');
      const response = await invoiceApi.upload(selectedFile);
      console.log('[DEBUG] Frontend OCR response:', response.data);
      console.log('[DEBUG] Response structure:', JSON.stringify(response.data, null, 2));

      if (response.data.success && response.data.extraction) {
        const extraction = response.data.extraction;
        console.log('[DEBUG] Mapping Madison extraction to form:', extraction);
        console.log('[DEBUG] vendor_name:', extraction.vendor_name);
        console.log('[DEBUG] invoice_number:', extraction.invoice_number);
        console.log('[DEBUG] invoice_date:', extraction.invoice_date);
        console.log('[DEBUG] amount:', extraction.amount);
        console.log('[DEBUG] currency:', extraction.currency);
        console.log('[DEBUG] PO validation:', response.data.po_validation);
        
        // Set PO validation and consensus results (display-only in AST mode)
        setPoValidation(response.data.po_validation);
        setConsensus(response.data.consensus);
        setRequiresManualVendorAssignment(response.data.requires_manual_vendor_assignment || false);

        // DSRS v7.3: Frontend treats extraction as SINGLE CANONICAL PAYLOAD.
        // PO validation is display-only; it NEVER drives form values, brand, amount, or qty.
        const brandToUse = extraction.brand || '';
        if (response.data.po_validation?.mode === 'AST_ISOLATED') {
          console.log('[DEBUG] AST mode: PO validation isolated, using extraction brand only');
        }

        // Format date (already in YYYY-MM-DD format from Madison extractor)
        const formattedDate = extraction.invoice_date || '';
        const formattedDueDate = extraction.due_date || '';

        setFormData({
          vendorName: extraction.vendor_name || '',
          invoiceNumber: extraction.invoice_number || '',
          invoiceDate: formattedDate,
          dueDate: formattedDueDate,
          amount: extraction.amount?.toString() || '',
          currency: extraction.currency || 'USD',
          category: extraction.category || '',
          brand: brandToUse,
          brandTier: extraction.brand_tier || '',
          season: extraction.season || '',
          orderType: extraction.order_type || '',
          poNumber: extraction.po_number || '',
          mpoNumber: extraction.mpo_number || '',
          qtyShipped: extraction.qty_shipped?.toString() || '',
          paymentTerms: extraction.payment_terms || '',
          bankName: extraction.bank_details?.bank_name || '',
          swiftCode: extraction.bank_details?.swift_code || '',
          accountNumber: extraction.bank_details?.account_number || '',
          notes: '',
          priority: extraction.is_urgent ? 'high' : 'medium',
        });
      } else {
        console.log('[DEBUG] Madison extraction response missing success or extraction');
        console.log('[DEBUG] success:', response.data.success);
        console.log('[DEBUG] extraction:', response.data.extraction);
      }
    } catch (error) {
      console.error('[DEBUG] OCR extraction failed:', error);
      // Fall back to empty form on error
      setFormData({
        vendorName: '',
        invoiceNumber: '',
        invoiceDate: '',
        dueDate: '',
        amount: '',
        currency: 'USD',
        category: '',
        brand: '',
        brandTier: '',
        season: '',
        orderType: '',
        poNumber: '',
        mpoNumber: '',
        qtyShipped: '',
        paymentTerms: '',
        bankName: '',
        swiftCode: '',
        accountNumber: '',
        notes: '',
        priority: 'medium',
      });
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Store invoice in-memory (bypass Supabase for now)
      const invoice = {
        id: crypto.randomUUID(),
        invoice_number: formData.invoiceNumber,
        vendor_name: formData.vendorName,
        amount: parseFloat(formData.amount),
        currency: formData.currency,
        category: formData.category,
        brand: formData.brand,
        brand_tier: formData.brandTier,
        season: formData.season,
        order_type: formData.orderType,
        po_number: formData.poNumber,
        mpo_number: formData.mpoNumber,
        qty_shipped: formData.qtyShipped ? parseFloat(formData.qtyShipped) : null,
        payment_terms: formData.paymentTerms,
        bank_name: formData.bankName,
        swift_code: formData.swiftCode,
        account_number: formData.accountNumber,
        status: 'pending_validation',
        priority: formData.priority,
        date_issued: formData.invoiceDate,
        date_due: formData.dueDate,
        notes: formData.notes,
        file_name: file.name,
        file_size: file.size,
        created_at: new Date().toISOString(),
      };

      // Store in localStorage for persistence across page reloads
      const existingInvoices = JSON.parse(localStorage.getItem('invoices') || '[]');
      existingInvoices.push(invoice);
      localStorage.setItem('invoices', JSON.stringify(existingInvoices));

      setUploadProgress(100);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });

      setTimeout(() => {
        setUploadComplete(true);
        setIsUploading(false);
      }, 500);
    } catch (error) {
      console.error('Upload failed:', error);
      setIsUploading(false);
      alert('Upload failed. Please try again.');
    }
  };

  const handleReset = () => {
    setFile(null);
    setFormData({
      vendorName: '',
      invoiceNumber: '',
      invoiceDate: '',
      dueDate: '',
      amount: '',
      currency: 'USD',
      category: '',
      brand: '',
      brandTier: '',
      season: '',
      orderType: '',
      poNumber: '',
      mpoNumber: '',
      qtyShipped: '',
      paymentTerms: '',
      bankName: '',
      swiftCode: '',
      accountNumber: '',
      notes: '',
      priority: 'medium',
    });
    setUploadProgress(0);
    setUploadComplete(false);
    setConsensus(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: '#000000',
              zIndex: 1000,
            }}
            onClick={handleClose}
          />

          {/* Modal */}
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#1e1b4b',
              border: '2px solid #ffffff',
              borderRadius: '24px',
              boxShadow: '0 24px 80px #000000',
              padding: '32px',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={handleClose}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
            >
              <X className="h-5 w-5 text-white" />
            </button>

            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">Upload Invoice</h2>
              <p className="text-sm text-slate-400">Supported formats: PDF, PNG, JPG, XLSX</p>
            </div>

            {/* Drag & Drop Zone */}
            {!file ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                style={{
                  height: '200px',
                  border: isDragging ? '2px dashed rgba(99, 102, 241, 0.8)' : '2px dashed rgba(99, 102, 241, 0.4)',
                  borderRadius: '16px',
                  background: isDragging ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 200ms ease',
                  marginBottom: '24px',
                }}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                <Upload className="h-12 w-12 text-indigo-400 mb-4" style={{ opacity: 0.7 }} />
                <p className="text-white text-base mb-2">Drag & drop your invoice here</p>
                <p className="text-slate-500 text-sm mb-4">or</p>
                <button
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid rgba(99, 102, 241, 0.6)',
                    borderRadius: '8px',
                    color: '#818cf8',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  Browse Files
                </button>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx"
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  className="hidden"
                  id="file-input"
                />
              </div>
            ) : (
              /* File Preview */
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-indigo-400" />
                  <div>
                    <p className="text-sm text-white font-medium">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  onClick={() => setFile(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                >
                  <X className="h-5 w-5 text-slate-400 hover:text-white transition-colors" />
                </button>
              </div>
            )}

            {/* Shimmer Animation for AI Extraction */}
            {isExtracting && (
              <div
                style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'rgba(99, 102, 241, 0.05)',
                  borderRadius: '12px',
                  border: '1px solid rgba(99, 102, 241, 0.2)',
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Sparkles className="h-5 w-5 text-indigo-400 animate-pulse" />
                  <p className="text-sm text-white">AI is extracting data...</p>
                </div>
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="h-3 rounded animate-shimmer"
                      style={{
                        width: `${Math.random() * 40 + 60}%`,
                        background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%)',
                        backgroundSize: '200% 100%',
                        animation: `shimmer 1.5s ease-in-out infinite`,
                        animationDelay: `${i * 0.2}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Form Fields */}
            {file && !isExtracting && (
              <div className="space-y-4" style={{ marginBottom: '24px' }}>
                {/* Consensus Extraction Confidence — DISPLAY ONLY */}
                {consensus && (
                  <div
                    style={{
                      background:
                        consensus.overall_status === 'APPROVED'
                          ? 'rgba(34, 197, 94, 0.1)'
                          : consensus.overall_status === 'REVIEW_REQUIRED'
                            ? 'rgba(234, 179, 8, 0.1)'
                            : 'rgba(239, 68, 68, 0.1)',
                      border:
                        consensus.overall_status === 'APPROVED'
                          ? '1px solid rgba(34, 197, 94, 0.3)'
                          : consensus.overall_status === 'REVIEW_REQUIRED'
                            ? '1px solid rgba(234, 179, 8, 0.3)'
                            : '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {consensus.overall_status === 'APPROVED'
                          ? '✅'
                          : consensus.overall_status === 'REVIEW_REQUIRED'
                            ? '⚠️'
                            : '🔴'}
                      </span>
                      <span
                        style={{
                          fontSize: '13px',
                          color:
                            consensus.overall_status === 'APPROVED'
                              ? '#22c55e'
                              : consensus.overall_status === 'REVIEW_REQUIRED'
                                ? '#eab308'
                                : '#ef4444',
                        }}
                      >
                        Extraction Confidence: {consensus.overall_confidence}% — {consensus.overall_status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                      Engines: {consensus.engines_used?.join(' + ') || 'pdf2json+madison'}
                      {consensus.extraction_time_ms ? ` · ${consensus.extraction_time_ms}ms` : ''}
                    </div>
                    {consensus.engine_notes && (
                      <div style={{ fontSize: '11px', color: '#fbbf24', marginBottom: '8px', fontStyle: 'italic' }}>
                        {consensus.engine_notes}
                      </div>
                    )}
                    {consensus.conflicts && consensus.conflicts.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                        {consensus.conflicts.map((conflict: any, i: number) => (
                          <div key={i} style={{ fontSize: '11px', color: '#f87171' }}>
                            {conflict.severity === 'CRITICAL' ? '🔴' : '⚠️'} {conflict.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* PO Validation Status — DISPLAY ONLY, never drives form values */}
                {poValidation && (
                  <div
                    style={{
                      background: (poValidation.mode === 'AST_ISOLATED' && poValidation.skipped)
                        ? 'rgba(59, 130, 246, 0.1)'
                        : poValidation.validation_result?.status === 'AUTO_APPROVED'
                          ? 'rgba(34, 197, 94, 0.1)'
                          : 'rgba(239, 68, 68, 0.1)',
                      border: (poValidation.mode === 'AST_ISOLATED' && poValidation.skipped)
                        ? '1px solid rgba(59, 130, 246, 0.3)'
                        : poValidation.validation_result?.status === 'AUTO_APPROVED'
                          ? '1px solid rgba(34, 197, 94, 0.3)'
                          : '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '10px',
                      padding: '12px 16px',
                      marginBottom: '16px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ fontSize: '16px' }}>
                        {(poValidation.mode === 'AST_ISOLATED' && poValidation.skipped)
                          ? '🔒'
                          : poValidation.validation_result?.status === 'AUTO_APPROVED'
                            ? '✅'
                            : '⚠️'}
                      </span>
                      <span style={{ fontSize: '13px', color: (poValidation.mode === 'AST_ISOLATED' && poValidation.skipped) ? '#3b82f6' : poValidation.validation_result?.status === 'AUTO_APPROVED' ? '#22c55e' : '#ef4444' }}>
                        {(poValidation.mode === 'AST_ISOLATED' && poValidation.skipped)
                          ? 'PO Validation Skipped'
                          : poValidation.validation_result?.status === 'AUTO_APPROVED'
                            ? 'Auto-Approved'
                            : poValidation.validation_result?.status === 'REVIEW_REQUIRED'
                              ? 'Review Required'
                              : poValidation.validation_result?.status === 'REJECTED'
                                ? 'Rejected'
                                : poValidation.po_found
                                  ? 'PO Found'
                                  : 'PO Not Found in NextGen'}
                      </span>
                    </div>
                    {(poValidation.mode === 'AST_ISOLATED' && poValidation.skipped) && (
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {poValidation.message}
                      </div>
                    )}
                    {(!poValidation.skipped || poValidation.mode !== 'AST_ISOLATED') && poValidation.po_found && poValidation.validation_result?.checks && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                        {poValidation.validation_result.checks.currency_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            {poValidation.validation_result.checks.currency_match ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span>Currency</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.vendor_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            {poValidation.validation_result.checks.vendor_match ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span>Vendor</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.brand_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            {poValidation.validation_result.checks.brand_match ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span>Brand</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.season_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            {poValidation.validation_result.checks.season_match ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span>Season</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.order_type_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#94a3b8' }}>
                            {poValidation.validation_result.checks.order_type_match ? (
                              <CheckCircle className="h-3 w-3 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            )}
                            <span>Order Type</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Row 1: Vendor Name | Invoice Number */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Vendor Name *</label>
                    <input
                      type="text"
                      value={formData.vendorName}
                      onChange={(e) => setFormData({ ...formData, vendorName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="Enter vendor name"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                    {requiresManualVendorAssignment && (
                      <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px' }}>
                        Vendor not recognized — please confirm or correct the vendor name above.
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Invoice Number *</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="Enter invoice number"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 2: Invoice Date | Due Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Invoice Date *</label>
                    <input
                      type="date"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Due Date *</label>
                    <input
                      type="date"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 3: Amount | Currency */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Amount *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="0.00"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Currency</label>
                    <select
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="USD" style={{ background: '#0f172a' }}>USD</option>
                      <option value="HKD" style={{ background: '#0f172a' }}>HKD</option>
                      <option value="IDR" style={{ background: '#0f172a' }}>IDR</option>
                      <option value="PHP" style={{ background: '#0f172a' }}>PHP</option>
                      <option value="EUR" style={{ background: '#0f172a' }}>EUR</option>
                      <option value="GBP" style={{ background: '#0f172a' }}>GBP</option>
                      <option value="JPY" style={{ background: '#0f172a' }}>JPY</option>
                    </select>
                  </div>
                </div>

                {/* Row 4: Category */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: 'white',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <option value="" style={{ background: '#0f172a' }}>Select category</option>
                    <option value="Trims" style={{ background: '#0f172a' }}>Trims</option>
                    <option value="Yarn" style={{ background: '#0f172a' }}>Yarn</option>
                    <option value="Sample" style={{ background: '#0f172a' }}>Sample</option>
                    <option value="Shipping" style={{ background: '#0f172a' }}>Shipping</option>
                    <option value="Lab" style={{ background: '#0f172a' }}>Lab</option>
                  </select>
                </div>

                {/* Row 5: Brand | Brand Tier */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Brand</label>
                    <input
                      type="text"
                      value={formData.brand}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      placeholder="e.g. Columbia Sportswear"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Brand Tier</label>
                    <select
                      value={formData.brandTier}
                      onChange={(e) => setFormData({ ...formData, brandTier: e.target.value as '' | 'TOP_10' | 'OTHER' })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="" style={{ background: '#0f172a' }}>Select tier</option>
                      <option value="TOP_10" style={{ background: '#0f172a' }}>Top 10</option>
                      <option value="OTHER" style={{ background: '#0f172a' }}>Other</option>
                    </select>
                  </div>
                </div>
                {formData.brand && !formData.brandTier && (
                  <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px' }}>
                    Brand tier could not be determined automatically — please confirm before submitting.
                  </div>
                )}

                {/* Row 6: Season | Order Type */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Season</label>
                    <input
                      type="text"
                      value={formData.season}
                      onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                      placeholder="e.g. F26, FW26"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Order Type</label>
                    <select
                      value={formData.orderType}
                      onChange={(e) => setFormData({ ...formData, orderType: e.target.value as '' | 'BULK' | 'SMS' | 'SAMPLE' })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="" style={{ background: '#0f172a' }}>Select type</option>
                      <option value="BULK" style={{ background: '#0f172a' }}>Bulk</option>
                      <option value="SMS" style={{ background: '#0f172a' }}>SMS</option>
                      <option value="SAMPLE" style={{ background: '#0f172a' }}>Sample</option>
                    </select>
                  </div>
                </div>

                {/* Row 7: PO Number | MPO Number */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">PO Number</label>
                    <input
                      type="text"
                      value={formData.poNumber}
                      onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                      placeholder="Optional"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">MPO Number *</label>
                    <input
                      type="text"
                      value={formData.mpoNumber}
                      onChange={(e) => setFormData({ ...formData, mpoNumber: e.target.value })}
                      placeholder="e.g. MPO15371"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 8: QTY SHIPPED (full width) */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">QTY SHIPPED</label>
                  <input
                    type="number"
                    value={formData.qtyShipped}
                    onChange={(e) => setFormData({ ...formData, qtyShipped: e.target.value })}
                    placeholder="Auto-extracted from line items"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: 'white',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 9: Payment Terms (full width) */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Payment Terms</label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder="e.g. Net 30, T/T 100% before shipment"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: 'white',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 9: Bank Name | SWIFT Code | Account Number (3 columns) */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Bank Name</label>
                    <input
                      type="text"
                      value={formData.bankName}
                      onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">SWIFT Code</label>
                    <input
                      type="text"
                      value={formData.swiftCode}
                      onChange={(e) => setFormData({ ...formData, swiftCode: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Account Number</label>
                    <input
                      type="text"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        color: 'white',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 10: Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Notes / Description</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      color: 'white',
                      outline: 'none',
                      transition: 'all 150ms ease',
                      resize: 'none',
                    }}
                    placeholder="Add any additional notes..."
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.15)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 6: Priority Toggle */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">Priority</label>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((priority) => (
                      <button
                        key={priority}
                        onClick={() => setFormData({ ...formData, priority })}
                        style={{
                          flex: 1,
                          padding: '8px 16px',
                          background: formData.priority === priority
                            ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                            : 'rgba(255, 255, 255, 0.05)',
                          border: formData.priority === priority
                            ? 'none'
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '8px',
                          color: formData.priority === priority ? 'white' : '#94a3b8',
                          cursor: 'pointer',
                          transition: 'all 150ms ease',
                          fontSize: '14px',
                          fontWeight: '500',
                        }}
                      >
                        {priority.charAt(0).toUpperCase() + priority.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div
              style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                paddingTop: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {!uploadComplete ? (
                <>
                  <button
                    onClick={handleClose}
                    style={{
                      padding: '10px 20px',
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      transition: 'color 150ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#94a3b8';
                    }}
                  >
                    Cancel
                  </button>
                  {!isUploading ? (
                    <button
                      onClick={handleUpload}
                      disabled={!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber}
                      style={{
                        padding: '10px 24px',
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        border: 'none',
                        borderRadius: '10px',
                        color: 'white',
                        cursor: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 'not-allowed' : 'pointer',
                        opacity: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 0.4 : 1,
                        boxShadow: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 'none' : '0 0 20px rgba(99, 102, 241, 0.45)',
                        transition: 'all 150ms ease',
                      }}
                    >
                      Upload Invoice
                    </button>
                  ) : (
                    /* Upload Progress */
                    <div style={{ width: '200px' }}>
                      <p className="text-xs text-slate-300 mb-2">Uploading invoice...</p>
                      <div
                        style={{
                          height: '6px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${uploadProgress}%`,
                            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                            borderRadius: '999px',
                            transition: 'width 200ms ease',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Success State */
                <div className="flex items-center gap-4">
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: 'rgba(34, 197, 94, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckCircle className="h-6 w-6 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Invoice uploaded successfully!</p>
                    <p className="text-sm text-slate-400">It will appear in your dashboard shortly.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      Upload Another
                    </button>
                    <button
                      onClick={handleClose}
                      style={{
                        padding: '8px 16px',
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        border: 'none',
                        borderRadius: '8px',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
