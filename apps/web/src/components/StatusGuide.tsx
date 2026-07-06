import { useState } from 'react';
import { InvoiceStatus } from '@ap-invoice/shared';
import { HelpCircle, X, ChevronRight } from 'lucide-react';

const statusGuide: Record<InvoiceStatus, { label: string; description: string; nextSteps: string; color: string }> = {
  [InvoiceStatus.RECEIVED]: { label: 'Received', description: 'Invoice uploaded but not yet processed.', nextSteps: 'OCR will extract data, then validation runs.', color: 'bg-amber-500' },
  [InvoiceStatus.OCR_PROCESSING]: { label: 'OCR Processing', description: 'System is reading invoice data.', nextSteps: 'Wait for extraction to complete.', color: 'bg-purple-500' },
  [InvoiceStatus.VALIDATION_PENDING]: { label: 'Validation Pending', description: 'Waiting for coordinator validation.', nextSteps: 'Coordinator reviews and runs validation.', color: 'bg-blue-500' },
  [InvoiceStatus.EXCEPTION_FLAGGED]: { label: 'Exception Flagged', description: 'Validation found issues.', nextSteps: 'Resolve exceptions or waive them, then re-validate.', color: 'bg-red-500' },
  [InvoiceStatus.ON_HOLD]: { label: 'On Hold', description: 'Held by batch threshold rule.', nextSteps: 'Another invoice for same vendor reaching $100 total releases this.', color: 'bg-yellow-500' },
  [InvoiceStatus.PENDING_COORDINATOR]: { label: 'Pending Coordinator', description: 'Awaiting coordinator approval.', nextSteps: 'Coordinator approves, then moves to manager.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_MANAGER]: { label: 'Pending Manager', description: 'Awaiting purchasing manager approval.', nextSteps: 'Manager approves, then moves to MLO.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_MLO_ACCOUNT_HOLDER]: { label: 'Pending MLO Account Holder', description: 'Awaiting MLO account holder approval.', nextSteps: 'MLO account holder approves.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_MLO_PLANNING_MANAGER]: { label: 'Pending MLO Planning Manager', description: 'Awaiting MLO planning manager approval.', nextSteps: 'MLO planning manager approves, then Sr. Manager.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_SR_MANAGER]: { label: 'Pending Sr. Manager', description: 'Awaiting senior manager approval.', nextSteps: 'Sr. Manager approves, then accounting.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_POLLY]: { label: 'Pending Polly', description: 'Awaiting Ms. Polly approval for high-value invoices.', nextSteps: 'Ms. Polly approves.', color: 'bg-amber-500' },
  [InvoiceStatus.PENDING_ACCOUNTING]: { label: 'Pending Accounting', description: 'Awaiting accounting review.', nextSteps: 'Accounting posts to QuickBooks.', color: 'bg-blue-500' },
  [InvoiceStatus.APPROVED]: { label: 'Approved', description: 'All approvals completed.', nextSteps: 'Accounting posts to QuickBooks.', color: 'bg-green-500' },
  [InvoiceStatus.POSTED_TO_QB]: { label: 'Posted to QB', description: 'Invoice posted to QuickBooks.', nextSteps: 'Accounting schedules payment.', color: 'bg-blue-500' },
  [InvoiceStatus.PAYMENT_SCHEDULED]: { label: 'Payment Scheduled', description: 'Payment date set.', nextSteps: 'Payment will be released on the scheduled date.', color: 'bg-blue-500' },
  [InvoiceStatus.PAID]: { label: 'Paid', description: 'Payment completed.', nextSteps: 'No further action needed.', color: 'bg-green-500' },
  [InvoiceStatus.REJECTED]: { label: 'Rejected', description: 'Invoice was rejected.', nextSteps: 'Coordinator reviews and corrects or discards.', color: 'bg-gray-500' },
};

export default function StatusGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
      >
        <HelpCircle className="h-4 w-4" />
        Status Guide
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Invoice Status Guide</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {Object.values(InvoiceStatus).map((status) => {
                const guide = statusGuide[status];
                if (!guide) return null;
                return (
                  <div key={status} className="p-3 bg-white/5 border border-white/10 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${guide.color}`} />
                      <span className="text-sm font-medium text-white">{guide.label}</span>
                      <span className="text-xs text-slate-500 ml-auto">{status}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">{guide.description}</p>
                    <p className="text-xs text-[#6366f1] mt-1 flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      {guide.nextSteps}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
