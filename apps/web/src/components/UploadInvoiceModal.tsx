import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Upload, FileText, X, Sparkles, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useQueryClient } from '@tanstack/react-query';

interface UploadInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UploadInvoiceModal({ isOpen, onClose }: UploadInvoiceModalProps) {
  console.log('UploadInvoiceModal render, isOpen:', isOpen);
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [formData, setFormData] = useState({
    vendorName: '',
    invoiceNumber: '',
    invoiceDate: '',
    dueDate: '',
    amount: '',
    currency: 'USD',
    category: '',
    notes: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
  });

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    if (aiExtractionEnabled) {
      setIsExtracting(true);
      setTimeout(() => {
        setIsExtracting(false);
        // Simulate AI extraction
        setFormData({
          vendorName: 'Acme Corporation',
          invoiceNumber: 'INV-2024-001',
          invoiceDate: new Date().toISOString().split('T')[0],
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          amount: '5000.00',
          currency: 'USD',
          category: 'Services',
          notes: '',
          priority: 'medium',
        });
      }, 1500);
    }
  }, [aiExtractionEnabled]);

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
      // Return early if Supabase is not configured
      if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase is not configured. Please set up environment variables.');
      }

      // Upload file to Supabase Storage
      const fileName = `${Date.now()}_${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      setUploadProgress(50);

      // Insert invoice record into database
      const { error: insertError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: formData.invoiceNumber,
          vendor_name: formData.vendorName,
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          category: formData.category,
          status: 'pending_validation',
          priority: formData.priority,
          date_issued: formData.invoiceDate,
          date_due: formData.dueDate,
          notes: formData.notes,
          file_url: uploadData.path,
          is_non_usd: formData.currency !== 'USD',
        });

      if (insertError) throw insertError;

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
      notes: '',
      priority: 'medium',
    });
    setUploadProgress(0);
    setUploadComplete(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && createPortal(
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 250 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
              zIndex: 1000,
            }}
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 250, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: 'rgba(15, 23, 42, 0.98)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '24px',
              boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6)',
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

            {/* AI Extraction Toggle */}
            <div
              style={{
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                borderRadius: '12px',
                padding: '12px 16px',
                marginBottom: '24px',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-5 w-5 text-indigo-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Auto-extract with AI</p>
                    <p className="text-xs text-slate-400">Automatically fill fields from your document</p>
                  </div>
                </div>
                <button
                  onClick={() => setAiExtractionEnabled(!aiExtractionEnabled)}
                  style={{
                    width: '44px',
                    height: '24px',
                    background: aiExtractionEnabled ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '2px',
                      left: aiExtractionEnabled ? '22px' : '2px',
                      width: '20px',
                      height: '20px',
                      background: 'white',
                      borderRadius: '50%',
                      transition: 'all 150ms ease',
                    }}
                  />
                </button>
              </div>
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
                    <option value="Utilities" style={{ background: '#0f172a' }}>Utilities</option>
                    <option value="Supplies" style={{ background: '#0f172a' }}>Supplies</option>
                    <option value="Services" style={{ background: '#0f172a' }}>Services</option>
                    <option value="Equipment" style={{ background: '#0f172a' }}>Equipment</option>
                    <option value="Other" style={{ background: '#0f172a' }}>Other</option>
                  </select>
                </div>

                {/* Row 5: Notes */}
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
                      disabled={!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount}
                      style={{
                        padding: '10px 24px',
                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        border: 'none',
                        borderRadius: '10px',
                        color: 'white',
                        cursor: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount) ? 'not-allowed' : 'pointer',
                        opacity: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount) ? 0.4 : 1,
                        boxShadow: (!file || !formData.vendorName || !formData.invoiceNumber || !formData.amount) ? 'none' : '0 0 20px rgba(99, 102, 241, 0.45)',
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
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
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
                  </motion.div>
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
          </motion.div>
        </>,
        document.body
      )}
    </AnimatePresence>
  );
}
