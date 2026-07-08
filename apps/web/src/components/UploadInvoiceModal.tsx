import { useState, useCallback } from 'react';
import { Upload, FileText, X, Sparkles, CheckCircle, AlertTriangle, Save } from 'lucide-react';
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
  const [ocrRawData, setOcrRawData] = useState<any>(null);
  const [requiresManualVendorAssignment, setRequiresManualVendorAssignment] = useState(false);
  const [matchedVendorId, setMatchedVendorId] = useState<string | null>(null);
  const [extractedBrandCode, setExtractedBrandCode] = useState<string | null>(null);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    vendorName: '',
    invoiceNumber: '',
    invoiceDate: '',
    dueDate: '',
    amount: '',
    currency: 'USD',
    documentType: '' as '' | 'PI' | 'INV' | 'CI' | 'SI' | 'STATEMENT',
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
  const [originalFormData, setOriginalFormData] = useState<typeof formData | null>(null);
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);

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
        setOcrRawData({
          extraction,
          bank_info: extraction.bank_details || {
            bank_name: extraction.bank_name || '',
            swift_code: extraction.swift_code || '',
            account_number: extraction.account_number || '',
          },
          signatures: extraction.signatures || [],
        });
        setRequiresManualVendorAssignment(response.data.requires_manual_vendor_assignment || false);
        setMatchedVendorId(response.data.vendor_match?.vendor_id || null);
        setExtractedBrandCode(extraction.brand_code || extraction.brand || null);

        // DSRS v7.3: Frontend treats extraction as SINGLE CANONICAL PAYLOAD.
        // PO validation is display-only; it NEVER drives form values, brand, amount, or qty.
        const brandToUse = extraction.brand || '';
        if (response.data.po_validation?.mode === 'AST_ISOLATED') {
          console.log('[DEBUG] AST mode: PO validation isolated, using extraction brand only');
        }

        // Format date (already in YYYY-MM-DD format from Madison extractor)
        const formattedDate = extraction.invoice_date || '';
        const formattedDueDate = extraction.due_date || '';

        const extractedFormData: typeof formData = {
          vendorName: extraction.vendor_name || '',
          invoiceNumber: extraction.invoice_number || '',
          invoiceDate: formattedDate,
          dueDate: formattedDueDate,
          amount: extraction.amount?.toString() || '',
          currency: extraction.currency || 'USD',
          documentType: (extraction.document_type || '') as '' | 'PI' | 'INV' | 'CI' | 'SI' | 'STATEMENT',
          category: extraction.category || '',
          brand: brandToUse,
          brandTier: (extraction.brand_tier || '') as '' | 'TOP_10' | 'OTHER',
          season: extraction.season || '',
          orderType: (extraction.order_type || '') as '' | 'BULK' | 'SMS' | 'SAMPLE',
          poNumber: extraction.po_number || '',
          mpoNumber: extraction.mpo_number || '',
          qtyShipped: extraction.qty_shipped?.toString() || '',
          paymentTerms: extraction.payment_terms || '',
          bankName: extraction.bank_details?.bank_name || '',
          swiftCode: extraction.bank_details?.swift_code || '',
          accountNumber: extraction.bank_details?.account_number || '',
          notes: '',
          priority: (extraction.is_urgent ? 'high' : 'medium') as 'low' | 'medium' | 'high',
        };
        setFormData(extractedFormData);
        setOriginalFormData(JSON.parse(JSON.stringify(extractedFormData)));
        setCorrectionSaved(false);
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
        documentType: '',
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
    setUploadProgress(50);

    try {
      const documentType = formData.documentType;
      const invoiceType =
        documentType === 'PI' ? 'PROFORMA' :
        documentType === 'INV' ? 'INVOICE' :
        documentType === 'CI' ? 'COMMERCIAL' :
        documentType === 'SI' ? 'SALES' :
        documentType === 'STATEMENT' ? 'STATEMENT' :
        'INVOICE';

      const ext = ocrRawData?.extraction || {};

      const invoicePayload = {
        invoice_number: formData.invoiceNumber,
        invoice_date: formData.invoiceDate || undefined,
        due_date: formData.dueDate || undefined,
        invoice_received_date: new Date().toISOString(),
        date_range_start: ext.date_range_start || undefined,
        date_range_end: ext.date_range_end || undefined,
        vendor_id: matchedVendorId || undefined,
        vendor_name_raw: formData.vendorName,
        total_amount: parseFloat(formData.amount),
        invoice_currency_original: ext.invoice_currency_original || ext.currency || undefined,
        exchange_rate_to_usd: ext.exchange_rate_to_usd || undefined,
        currency: formData.currency,
        payment_terms: formData.paymentTerms || undefined,
        incoterm: ext.incoterm || undefined,
        subtotal: ext.subtotal || undefined,
        tax_amount: ext.tax_amount || undefined,
        discount_amount: ext.discount_amount || undefined,
        bank_charges: ext.bank_charges || 0,
        freight_charges: ext.freight_charges || 0,
        additional_charges: ext.additional_charges || 0,
        ship_to: ext.ship_to || undefined,
        sold_to: ext.sold_to || undefined,
        invoice_type: invoiceType,
        category: ext.category || 'TRIMS',
        order_type: formData.orderType || undefined,
        brand: formData.brand || undefined,
        brand_code: extractedBrandCode || undefined,
        season: formData.season || undefined,
        qty_shipped: formData.qtyShipped ? parseFloat(formData.qtyShipped) : ext.qty_shipped || undefined,
        mpo_number: formData.mpoNumber || undefined,
        customer_po_number: formData.poNumber || undefined,
        bill_to_entity: ext.bill_to_entity || 'MADISON_88_LTD',
        is_handwritten: ext.is_handwritten || false,
        is_urgent: formData.priority === 'high' || ext.is_urgent || false,
        priority_flag: formData.priority === 'high' || ext.is_urgent || false,
        priority_pay_date: ext.priority_pay_date || undefined,
        bank_name: formData.bankName || undefined,
        swift_code: formData.swiftCode || undefined,
        account_number: formData.accountNumber || undefined,
        ocr_confidence_score: ext.ocr_confidence_score || undefined,
        signatures: ext.signatures || undefined,
        source: 'MANUAL_UPLOAD',
        po_validation: poValidation || undefined,
        ocr_raw_data: ocrRawData || undefined,
      };

      const response = await invoiceApi.create(invoicePayload);
      const createdInvoice = response.data;
      setCreatedInvoiceId(createdInvoice.id);
      setUploadProgress(100);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });

      setTimeout(() => {
        setUploadComplete(true);
        setIsUploading(false);
      }, 500);
    } catch (error: any) {
      console.error('Upload failed:', error);
      setIsUploading(false);
      const serverMessage = error?.response?.data?.message || error?.response?.data?.error?.message;
      alert(serverMessage || 'Failed to save invoice to the server. Please try again.');
    }
  };

  const handleSaveCorrection = async () => {
    if (!originalFormData) return;

    setIsSavingCorrection(true);
    try {
      const originalFields = {
        vendor_name: originalFormData.vendorName,
        invoice_number: originalFormData.invoiceNumber,
        invoice_date: originalFormData.invoiceDate,
        due_date: originalFormData.dueDate,
        total_amount: originalFormData.amount ? parseFloat(originalFormData.amount) : undefined,
        currency: originalFormData.currency,
        document_type: originalFormData.documentType,
        category: originalFormData.category,
        brand: originalFormData.brand,
        brand_tier: originalFormData.brandTier,
        season: originalFormData.season,
        order_type: originalFormData.orderType,
        po_number: originalFormData.poNumber,
        mpo_number: originalFormData.mpoNumber,
        qty_shipped: originalFormData.qtyShipped ? parseFloat(originalFormData.qtyShipped) : undefined,
        payment_terms: originalFormData.paymentTerms,
        bank_name: originalFormData.bankName,
        swift_code: originalFormData.swiftCode,
        account_number: originalFormData.accountNumber,
        priority: originalFormData.priority,
      };

      const correctedFields = {
        vendor_name: formData.vendorName,
        invoice_number: formData.invoiceNumber,
        invoice_date: formData.invoiceDate,
        due_date: formData.dueDate,
        total_amount: formData.amount ? parseFloat(formData.amount) : undefined,
        currency: formData.currency,
        document_type: formData.documentType,
        category: formData.category,
        brand: formData.brand,
        brand_tier: formData.brandTier,
        season: formData.season,
        order_type: formData.orderType,
        po_number: formData.poNumber,
        mpo_number: formData.mpoNumber,
        qty_shipped: formData.qtyShipped ? parseFloat(formData.qtyShipped) : undefined,
        payment_terms: formData.paymentTerms,
        bank_name: formData.bankName,
        swift_code: formData.swiftCode,
        account_number: formData.accountNumber,
        priority: formData.priority,
      };

      const rawText = ocrRawData?.extraction?.raw_text || ocrRawData?.extraction?.rawText || '';

      if (createdInvoiceId) {
        await invoiceApi.saveCorrection(createdInvoiceId, {
          vendor_name: formData.vendorName,
          raw_text: rawText,
          original_fields: originalFields,
          corrected_fields: correctedFields,
          note: 'Manual correction from upload modal',
        });
      } else {
        await invoiceApi.saveStandaloneCorrection({
          vendor_name: formData.vendorName,
          raw_text: rawText,
          original_fields: originalFields,
          corrected_fields: correctedFields,
          note: 'Manual correction from upload modal (no invoice yet)',
        });
      }

      setCorrectionSaved(true);
    } catch (error: any) {
      console.error('Failed to save correction:', error);
      const message = error?.response?.data?.message || error?.response?.data?.error?.message || error?.message || 'Failed to save correction. Please try again.';
      alert(message);
    } finally {
      setIsSavingCorrection(false);
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
      documentType: '',
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
    setOriginalFormData(null);
    setCorrectionSaved(false);
    setIsSavingCorrection(false);
    setUploadProgress(0);
    setUploadComplete(false);
    setConsensus(null);
    setOcrRawData(null);
    setPoValidation(null);
    setMatchedVendorId(null);
    setExtractedBrandCode(null);
    setCreatedInvoiceId(null);
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
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
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
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '24px',
              boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
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
                background: 'var(--bg-elevated)',
                border: 'none',
                borderRadius: '8px',
                padding: '8px',
                cursor: 'pointer',
                transition: 'background 150ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-card-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-elevated)';
              }}
            >
              <X className="h-5 w-5" style={{ color: 'var(--text-primary)' }} />
            </button>

            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Upload Invoice</h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Supported formats: PDF, PNG, JPG, XLSX</p>
            </div>

            {/* Drag & Drop Zone */}
            {!file ? (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                style={{
                  height: '200px',
                  border: isDragging ? '2px dashed color-mix(in srgb, var(--accent-purple) 80%, transparent)' : '2px dashed color-mix(in srgb, var(--accent-purple) 40%, transparent)',
                  borderRadius: '16px',
                  background: isDragging ? 'color-mix(in srgb, var(--accent-purple) 10%, transparent)' : 'color-mix(in srgb, var(--accent-purple) 5%, transparent)',
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
                <Upload className="h-12 w-12 mb-4" style={{ color: 'var(--accent-purple)', opacity: 0.7 }} />
                <p className="text-base mb-2" style={{ color: 'var(--text-primary)' }}>Drag & drop your invoice here</p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>or</p>
                <button
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid color-mix(in srgb, var(--accent-purple) 60%, transparent)',
                    borderRadius: '8px',
                    color: 'var(--accent-violet)',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-purple) 10%, transparent)';
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
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5" style={{ color: 'var(--accent-purple)' }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{file.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</p>
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
                  <X className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            )}

            {/* Shimmer Animation for AI Extraction */}
            {isExtracting && (
              <div
                style={{
                  marginBottom: '24px',
                  padding: '16px',
                  background: 'color-mix(in srgb, var(--accent-purple) 5%, transparent)',
                  borderRadius: '12px',
                  border: '1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent)',
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <Sparkles className="h-5 w-5 animate-pulse" style={{ color: 'var(--accent-purple)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>AI is extracting data...</p>
                </div>
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="h-3 rounded animate-shimmer"
                      style={{
                        width: `${Math.random() * 40 + 60}%`,
                        background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-card-hover) 50%, var(--bg-elevated) 75%)',
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
                          ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)'
                          : consensus.overall_status === 'REVIEW_REQUIRED'
                            ? 'color-mix(in srgb, var(--accent-amber) 10%, transparent)'
                            : 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                      border:
                        consensus.overall_status === 'APPROVED'
                          ? '1px solid color-mix(in srgb, var(--accent-lime) 30%, transparent)'
                          : consensus.overall_status === 'REVIEW_REQUIRED'
                            ? '1px solid color-mix(in srgb, var(--accent-amber) 30%, transparent)'
                            : '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
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
                              ? 'var(--accent-lime)'
                              : consensus.overall_status === 'REVIEW_REQUIRED'
                                ? 'var(--accent-amber)'
                                : 'var(--accent-red)',
                        }}
                      >
                        Extraction Confidence: {consensus.overall_confidence}% — {consensus.overall_status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Engines: {consensus.engines_used?.join(' + ') || 'pdf2json+madison'}
                      {consensus.extraction_time_ms ? ` · ${consensus.extraction_time_ms}ms` : ''}
                    </div>
                    {consensus.engine_notes && (
                      <div style={{ fontSize: '11px', color: 'var(--accent-amber)', marginBottom: '8px', fontStyle: 'italic' }}>
                        {consensus.engine_notes}
                      </div>
                    )}
                    {consensus.conflicts && consensus.conflicts.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                        {consensus.conflicts.map((conflict: any, i: number) => (
                          <div key={i} style={{ fontSize: '11px', color: 'var(--accent-red)' }}>
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
                        ? 'color-mix(in srgb, var(--accent-blue) 10%, transparent)'
                        : poValidation.validation_result?.status === 'AUTO_APPROVED'
                          ? 'color-mix(in srgb, var(--accent-lime) 10%, transparent)'
                          : 'color-mix(in srgb, var(--accent-red) 10%, transparent)',
                      border: (poValidation.mode === 'AST_ISOLATED' && poValidation.skipped)
                        ? '1px solid color-mix(in srgb, var(--accent-blue) 30%, transparent)'
                        : poValidation.validation_result?.status === 'AUTO_APPROVED'
                          ? '1px solid color-mix(in srgb, var(--accent-lime) 30%, transparent)'
                          : '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
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
                      <span style={{ fontSize: '13px', color: (poValidation.mode === 'AST_ISOLATED' && poValidation.skipped) ? 'var(--accent-blue)' : poValidation.validation_result?.status === 'AUTO_APPROVED' ? 'var(--accent-lime)' : 'var(--accent-red)' }}>
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
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {poValidation.message}
                      </div>
                    )}
                    {(!poValidation.skipped || poValidation.mode !== 'AST_ISOLATED') && poValidation.po_found && poValidation.validation_result?.checks && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                        {poValidation.validation_result.checks.currency_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {poValidation.validation_result.checks.currency_match ? (
                              <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} />
                            ) : (
                              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />
                            )}
                            <span>Currency</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.vendor_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {poValidation.validation_result.checks.vendor_match ? (
                              <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} />
                            ) : (
                              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />
                            )}
                            <span>Vendor</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.brand_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {poValidation.validation_result.checks.brand_match ? (
                              <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} />
                            ) : (
                              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />
                            )}
                            <span>Brand</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.season_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {poValidation.validation_result.checks.season_match ? (
                              <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} />
                            ) : (
                              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />
                            )}
                            <span>Season</span>
                          </div>
                        )}
                        {poValidation.validation_result.checks.order_type_match !== undefined && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {poValidation.validation_result.checks.order_type_match ? (
                              <CheckCircle className="h-3 w-3" style={{ color: 'var(--accent-lime)' }} />
                            ) : (
                              <AlertTriangle className="h-3 w-3" style={{ color: 'var(--accent-amber)' }} />
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
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Vendor Name *</label>
                    <input
                      type="text"
                      value={formData.vendorName}
                      onChange={(e) => setFormData({ ...formData, vendorName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="Enter vendor name"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                    {requiresManualVendorAssignment && (
                      <div style={{ fontSize: '12px', color: 'var(--accent-amber)', marginTop: '4px' }}>
                        Vendor not recognized — please confirm or correct the vendor name above.
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Invoice Number *</label>
                    <input
                      type="text"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="Enter invoice number"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 2: Invoice Date | Due Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Invoice Date *</label>
                    <input
                      type="date"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Due Date *</label>
                    <input
                      type="date"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 3: Amount | Currency */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Amount *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      placeholder="0.00"
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Currency</label>
                    <select
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="USD" style={{ background: 'var(--input-bg)' }}>USD</option>
                      <option value="HKD" style={{ background: 'var(--input-bg)' }}>HKD</option>
                      <option value="IDR" style={{ background: 'var(--input-bg)' }}>IDR</option>
                      <option value="PHP" style={{ background: 'var(--input-bg)' }}>PHP</option>
                      <option value="EUR" style={{ background: 'var(--input-bg)' }}>EUR</option>
                      <option value="GBP" style={{ background: 'var(--input-bg)' }}>GBP</option>
                      <option value="JPY" style={{ background: 'var(--input-bg)' }}>JPY</option>
                    </select>
                  </div>
                </div>

                {/* Row 4: Document Type */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Document Type</label>
                  <select
                    value={formData.documentType}
                    onChange={(e) => setFormData({ ...formData, documentType: e.target.value as any })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>Select document type</option>
                    <option value="PI" style={{ background: 'var(--input-bg)' }}>Proforma Invoice (PI)</option>
                    <option value="INV" style={{ background: 'var(--input-bg)' }}>Invoice (INV)</option>
                    <option value="CI" style={{ background: 'var(--input-bg)' }}>Commercial Invoice (CI)</option>
                    <option value="SI" style={{ background: 'var(--input-bg)' }}>Sales Invoice (SI)</option>
                    <option value="STATEMENT" style={{ background: 'var(--input-bg)' }}>Statement</option>
                  </select>
                </div>

                {/* Row 5: Category */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                  >
                    <option value="" style={{ background: 'var(--input-bg)' }}>Select category</option>
                    <option value="Trims" style={{ background: 'var(--input-bg)' }}>Trims</option>
                    <option value="Yarn" style={{ background: 'var(--input-bg)' }}>Yarn</option>
                    <option value="Sample" style={{ background: 'var(--input-bg)' }}>Sample</option>
                    <option value="Shipping" style={{ background: 'var(--input-bg)' }}>Shipping</option>
                    <option value="Lab" style={{ background: 'var(--input-bg)' }}>Lab</option>
                  </select>
                </div>

                {/* Row 5: Brand | Brand Tier */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Brand</label>
                    <input
                      type="text"
                      value={formData.brand}
                      onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                      placeholder="e.g. Columbia Sportswear"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Brand Tier</label>
                    <select
                      value={formData.brandTier}
                      onChange={(e) => setFormData({ ...formData, brandTier: e.target.value as '' | 'TOP_10' | 'OTHER' })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="" style={{ background: 'var(--input-bg)' }}>Select tier</option>
                      <option value="TOP_10" style={{ background: 'var(--input-bg)' }}>Top 10</option>
                      <option value="OTHER" style={{ background: 'var(--input-bg)' }}>Other</option>
                    </select>
                  </div>
                </div>
                {formData.brand && !formData.brandTier && (
                  <div style={{ fontSize: '12px', color: 'var(--accent-amber)', marginTop: '4px' }}>
                    Brand tier could not be determined automatically — please confirm before submitting.
                  </div>
                )}

                {/* Row 6: Season | Order Type */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Season</label>
                    <input
                      type="text"
                      value={formData.season}
                      onChange={(e) => setFormData({ ...formData, season: e.target.value })}
                      placeholder="e.g. F26, FW26"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Order Type</label>
                    <select
                      value={formData.orderType}
                      onChange={(e) => setFormData({ ...formData, orderType: e.target.value as '' | 'BULK' | 'SMS' | 'SAMPLE' })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <option value="" style={{ background: 'var(--input-bg)' }}>Select type</option>
                      <option value="BULK" style={{ background: 'var(--input-bg)' }}>Bulk</option>
                      <option value="SMS" style={{ background: 'var(--input-bg)' }}>SMS</option>
                      <option value="SAMPLE" style={{ background: 'var(--input-bg)' }}>Sample</option>
                    </select>
                  </div>
                </div>

                {/* Row 7: PO Number | MPO Number */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>PO Number</label>
                    <input
                      type="text"
                      value={formData.poNumber}
                      onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                      placeholder="Optional"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>MPO Number *</label>
                    <input
                      type="text"
                      value={formData.mpoNumber}
                      onChange={(e) => setFormData({ ...formData, mpoNumber: e.target.value.toUpperCase() })}
                      placeholder="e.g. MPO015189"
                      pattern="^MPO\d{5,8}$"
                      title="MPO must be MPO followed by 5 to 8 digits (e.g. MPO14751 or MPO015189)"
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 8: QTY SHIPPED (full width) */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>QTY SHIPPED</label>
                  <input
                    type="number"
                    value={formData.qtyShipped}
                    onChange={(e) => setFormData({ ...formData, qtyShipped: e.target.value })}
                    placeholder="Auto-extracted from line items"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--input-border)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 9: Payment Terms (full width) */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Payment Terms</label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder="e.g. Net 30, T/T 100% before shipment"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 150ms ease',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--input-border)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 9: Bank Name | SWIFT Code | Account Number (3 columns) */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Bank Name</label>
                    <input
                      type="text"
                      value={formData.bankName}
                      onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>SWIFT Code</label>
                    <input
                      type="text"
                      value={formData.swiftCode}
                      onChange={(e) => setFormData({ ...formData, swiftCode: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Account Number</label>
                    <input
                      type="text"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        borderRadius: '10px',
                        color: 'var(--text-primary)',
                        outline: 'none',
                        transition: 'all 150ms ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'var(--input-border)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>
                </div>

                {/* Row 10: Notes */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Notes / Description</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--input-border)',
                      borderRadius: '10px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'all 150ms ease',
                      resize: 'none',
                    }}
                    placeholder="Add any additional notes..."
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--accent-purple) 60%, transparent)';
                      e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-purple) 15%, transparent)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--input-border)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                </div>

                {/* Row 6: Priority Toggle */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Priority</label>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as const).map((priority) => (
                      <button
                        key={priority}
                        onClick={() => setFormData({ ...formData, priority })}
                        style={{
                          flex: 1,
                          padding: '8px 16px',
                          background: formData.priority === priority
                            ? 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))'
                            : 'var(--bg-elevated)',
                          border: formData.priority === priority
                            ? 'none'
                            : '1px solid var(--border-color)',
                          borderRadius: '8px',
                          color: formData.priority === priority ? 'var(--text-inverse)' : 'var(--text-muted)',
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
                borderTop: '1px solid var(--border-color)',
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
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      transition: 'color 150ms ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    Cancel
                  </button>
                  {!isUploading ? (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <button
                        onClick={handleSaveCorrection}
                        disabled={isSavingCorrection || correctionSaved || !originalFormData}
                        style={{
                          padding: '10px 20px',
                          background: correctionSaved ? 'color-mix(in srgb, var(--accent-lime) 15%, transparent)' : 'color-mix(in srgb, var(--accent-violet) 15%, transparent)',
                          border: `1px solid ${correctionSaved ? 'color-mix(in srgb, var(--accent-lime) 30%, transparent)' : 'color-mix(in srgb, var(--accent-violet) 40%, transparent)'}`,
                          borderRadius: '10px',
                          color: correctionSaved ? 'var(--accent-lime)' : 'var(--accent-violet)',
                          cursor: (isSavingCorrection || correctionSaved || !originalFormData) ? 'not-allowed' : 'pointer',
                          opacity: (isSavingCorrection || correctionSaved || !originalFormData) ? 0.5 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 150ms ease',
                        }}
                      >
                        {correctionSaved ? (
                          <>
                            <CheckCircle className="h-4 w-4" /> Saved
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" /> Save Correction
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleUpload}
                        disabled={!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber}
                        style={{
                          padding: '10px 24px',
                          background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))',
                          border: 'none',
                          borderRadius: '10px',
                          color: 'var(--text-inverse)',
                          cursor: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 'not-allowed' : 'pointer',
                          opacity: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 0.4 : 1,
                          boxShadow: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount || !formData.mpoNumber) ? 'none' : '0 0 20px color-mix(in srgb, var(--accent-purple) 45%, transparent)',
                          transition: 'all 150ms ease',
                        }}
                      >
                        Upload Invoice
                      </button>
                    </div>
                  ) : (
                    /* Upload Progress */
                    <div style={{ width: '200px' }}>
                      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Uploading invoice...</p>
                      <div
                        style={{
                          height: '6px',
                          background: 'var(--bg-elevated)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${uploadProgress}%`,
                            background: 'linear-gradient(90deg, var(--accent-purple), var(--accent-violet))',
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
                      background: 'color-mix(in srgb, var(--accent-lime) 15%, transparent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckCircle className="h-6 w-6" style={{ color: 'var(--accent-lime)' }} />
                  </div>
                  <div>
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Invoice uploaded successfully!</p>
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>It will appear in your dashboard shortly.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      style={{
                        padding: '8px 16px',
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
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
                        background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-violet))',
                        border: 'none',
                        borderRadius: '8px',
                        color: 'var(--text-inverse)',
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
