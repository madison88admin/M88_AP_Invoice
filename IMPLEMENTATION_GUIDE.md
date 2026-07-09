# Implementation Guide - Approved Changes

**Status:** All decisions confirmed - Ready for development  
**Last Updated:** 2026-07-03

---

## ✅ COMPLETED: Vendor Threshold Blocking

### Changes Made:

1. **Added Exception Type**
   - `packages/shared/src/types.ts` - Added `VENDOR_THRESHOLD_EXCEEDED` to `ExceptionReason` enum
   - `packages/db/prisma/schema.prisma` - Added `VENDOR_THRESHOLD_EXCEEDED` to schema enum

2. **Added Validation Function**
   - `apps/api/src/services/validationService.ts`:
     - Added `validateVendorThreshold()` function (Rule 18)
     - Checks cumulative vendor spend for past 90 days
     - Threshold: $500,000
     - Blocks if exceeded, creates exception

3. **Integrated into Validation Pipeline**
   - Added rule to `validateInvoiceWithData()` rules array
   - Added rule to `validateInvoice()` execution flow

4. **Added Approval Blocking**
   - `apps/api/src/services/approvalService.ts`:
     - Added check in `createApprovalRequest()` function
     - Prevents approval if unresolved `VENDOR_THRESHOLD_EXCEEDED` exception exists
     - Throws error message: *"Cannot approve: vendor cumulative threshold exceeded..."*

### Next Steps:
- [ ] Run `prisma migrate dev` to create migration
- [ ] Rebuild Prisma client: `pnpm exec prisma generate`
- [ ] Update validation tests to include vendor threshold cases
- [ ] Add UI indicator for blocked invoices with threshold reason

---

## 🚀 TODO: Payment Batch Export (Manual Export to CitiBusiness)

### Configuration
- **Export Format:** CSV (compatible with CitiBusiness upload)
- **Export Timing:** After CFO approves payment batch
- **Manual Step:** Associate downloads file and uploads to CitiBusiness

### Implementation Steps:

#### Step 1: Create Export Service
**File:** `apps/api/src/services/paymentExportService.ts` (NEW)

```typescript
import { PaymentBatch, Invoice } from '@prisma/client';

export interface PaymentExportRow {
  invoice_id: string;
  invoice_number: string;
  vendor_name: string;
  amount_usd: number;
  currency: string;
  bank_name: string;
  account_number: string;
  swift_code: string;
  payment_date: string;
  remittance_reference: string;
}

export async function generatePaymentExport(batchId: string): Promise<PaymentExportRow[]> {
  // Fetch batch with all invoices
  const batch = await prisma.paymentBatch.findUnique({
    where: { id: batchId },
    include: {
      payment_batch_items: {
        include: {
          invoice: {
            include: {
              vendor: true,
            },
          },
        },
      },
    },
  });

  if (!batch) {
    throw new Error(`Payment batch ${batchId} not found`);
  }

  // Convert to export format
  const rows: PaymentExportRow[] = batch.payment_batch_items.map((item) => ({
    invoice_id: item.invoice.id,
    invoice_number: item.invoice.invoice_number,
    vendor_name: item.invoice.vendor.name,
    amount_usd: Number(item.invoice.total_amount),
    currency: item.invoice.currency || 'USD',
    bank_name: item.invoice.vendor.bank_name || '',
    account_number: item.invoice.vendor.account_number || '',
    swift_code: item.invoice.vendor.swift_code || '',
    payment_date: batch.payment_date.toISOString().split('T')[0],
    remittance_reference: `${batch.batch_number}-${item.invoice.invoice_number}`,
  }));

  return rows;
}

export function convertToCSV(rows: PaymentExportRow[]): string {
  if (rows.length === 0) return '';

  // CSV header
  const headers = Object.keys(rows[0]);
  const csvLines: string[] = [headers.join(',')];

  // CSV rows with proper quoting for fields with commas
  rows.forEach((row) => {
    const values = headers.map((header) => {
      const value = (row as any)[header];
      // Quote fields with commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csvLines.push(values.join(','));
  });

  return csvLines.join('\n');
}

export function generateFilename(batchNumber: string): string {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `payment-batch-${batchNumber}-${date}.csv`;
}
```

#### Step 2: Create Export Controller Endpoint
**File:** `apps/api/src/controllers/paymentBatch.ts` (UPDATE)

Add new endpoint:

```typescript
export async function getPaymentBatchExport(req: Request, res: Response) {
  const { id: batchId } = req.params;

  try {
    // Verify batch exists and is approved
    const batch = await prisma.paymentBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status !== 'PROCESSED') {
      return res.status(400).json({
        error: 'Batch must be approved by CFO before export',
        current_status: batch.status,
      });
    }

    // Generate export data
    const exportRows = await paymentExportService.generatePaymentExport(batchId);
    const csv = paymentExportService.convertToCSV(exportRows);
    const filename = paymentExportService.generateFilename(batch.batch_number);

    // Return as downloadable file
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    logger.error('Payment export failed:', error);
    res.status(500).json({ error: 'Failed to generate payment export' });
  }
}
```

#### Step 3: Add Route
**File:** `apps/api/src/routes/paymentBatches.ts` (UPDATE)

```typescript
router.get('/:id/export', authenticateUser, getPaymentBatchExport);
```

#### Step 4: Update Frontend
**File:** `apps/web/src/components/PaymentBatchApproval.tsx` (UPDATE)

Add button after CFO approval:

```typescript
const handleDownloadExport = async () => {
  try {
    const response = await fetch(`/api/payment-batches/${batch.id}/export`);
    if (!response.ok) {
      throw new Error('Export failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-batch-${batch.batch_number}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download failed:', error);
    toast.error('Failed to download payment export');
  }
};

// In JSX:
{batch.status === 'PROCESSED' && (
  <button
    onClick={handleDownloadExport}
    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
  >
    📥 Download for CitiBusiness
  </button>
)}
```

### Testing Checklist:
- [ ] Generate CSV export for sample batch
- [ ] Verify CSV format is correct
- [ ] Test with Excel/Google Sheets to verify quoting
- [ ] Download via UI works correctly
- [ ] Filename includes date
- [ ] All vendor bank details present in export

---

## 🚀 TODO: Forecast Visibility for Pending Invoices

### Requirement
Pending invoices (any non-rejected status) should be visible in forecasting and reporting, but not posted to GL or included in payment batches until approved.

### Implementation Steps:

#### Step 1: Update Report Queries
**File:** `apps/api/src/services/reportService.ts` (UPDATE)

```typescript
// Current queries likely have WHERE status = 'POSTED' or similar
// Update forecast queries to include ALL except REJECTED

// Example update for cash flow forecast:
export async function getCashFlowForecast(dateRange: DateRange) {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { not: 'REJECTED' as any },  // Include all non-rejected
      invoice_date: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    },
    select: {
      id: true,
      invoice_number: true,
      vendor_id: true,
      total_amount: true,
      due_date: true,
      currency: true,
      status: true,
    },
  });

  return invoices;
}

// For Aged AP Report:
export async function getAgedAPReport() {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { not: 'REJECTED' as any },  // Include all non-rejected
    },
    include: {
      vendor: true,
    },
  });

  // Group by aging bucket
  return groupByAgingBucket(invoices);
}

// For Vendor Balance Report:
export async function getVendorBalanceReport() {
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { not: 'REJECTED' as any },  // Include all non-rejected
    },
  });

  return groupByVendor(invoices);
}

// For Dashboard AP Liability Widget:
export async function getTotalAPLiability() {
  const result = await prisma.invoice.aggregate({
    _sum: {
      total_amount: true,
    },
    where: {
      status: { not: 'REJECTED' as any },  // Include all non-rejected
    },
  });

  return result._sum.total_amount || 0;
}
```

#### Step 2: Update Dashboard Widgets
**File:** `apps/web/src/components/Dashboard.tsx` (UPDATE)

Update AP Liability widget to show pending invoices in total:

```typescript
export function APLiabilityWidget({ totalAP, pendingAP, postedAP }: APWidgetProps) {
  return (
    <Card>
      <CardHeader>Total AP Liability</CardHeader>
      <CardBody>
        <div className="text-3xl font-bold">${totalAP.toFixed(2)}</div>
        <div className="text-sm text-gray-500 mt-2">
          Includes: Pending ${pendingAP.toFixed(2)} + Posted ${postedAP.toFixed(2)}
        </div>
        <div className="mt-4 text-xs text-gray-600">
          <p>📊 This reflects all invoices in the system,</p>
          <p>including pending approvals for accurate forecasting.</p>
        </div>
      </CardBody>
    </Card>
  );
}
```

#### Step 3: Add Report Filters
**File:** `apps/web/src/components/ReportView.tsx` (UPDATE)

Add filter for report visibility:

```typescript
export interface ReportFilter {
  includeRejected: boolean;  // false by default
  statusFilter: InvoiceStatus[];  // Default: all except REJECTED
  dateRange: DateRange;
  vendorFilter?: string;
}

export function ReportView() {
  const [filters, setFilters] = useState<ReportFilter>({
    includeRejected: false,
    statusFilter: [
      InvoiceStatus.RECEIVED,
      InvoiceStatus.PENDING_APPROVAL,
      InvoiceStatus.EXCEPTION_FLAGGED,
      InvoiceStatus.APPROVED,
      InvoiceStatus.POSTED,
      InvoiceStatus.PAID,
    ],
    dateRange: { start: 90daysAgo, end: today },
  });

  return (
    <div>
      <ReportFilters
        filters={filters}
        onChange={setFilters}
      />
      {/* Report table with pending invoices visible */}
    </div>
  );
}
```

#### Step 4: Add Documentation Note
**File:** `docs/USER_FLOW.md` (UPDATE - Already done in section 6.7)

Ensure documentation states: Pending invoices visible in forecasts but restricted from posting/payment.

### Testing Checklist:
- [ ] Cash flow forecast includes pending invoices
- [ ] Aged AP report shows pending invoices in correct aging buckets
- [ ] Vendor balance report includes pending invoices
- [ ] Dashboard AP liability widget shows pending + posted totals
- [ ] Rejected invoices excluded from all forecasts
- [ ] Drill-down from reports shows pending invoice details
- [ ] Posted invoices have correct status indicators in reports
- [ ] Payment batches still exclude pending invoices

---

## 📋 Implementation Sequence (Recommended)

### Phase 1: Vendor Threshold (DONE - Awaiting Migration)
1. ✅ Run `prisma migrate dev`
2. ✅ Generate Prisma client
3. [ ] Update validation tests
4. [ ] Test blocking behavior end-to-end

### Phase 2: Payment Export (2-3 hours)
1. [ ] Create paymentExportService.ts
2. [ ] Add controller endpoint
3. [ ] Add route
4. [ ] Update frontend with export button
5. [ ] Test CSV generation and download

### Phase 3: Forecast Visibility (2-4 hours)
1. [ ] Update report queries
2. [ ] Update dashboard widgets
3. [ ] Add report filters
4. [ ] Update documentation
5. [ ] Test all report views include pending invoices

### Phase 4: Testing & QA (2-4 hours)
1. [ ] End-to-end vendor threshold flow
2. [ ] Payment export accuracy
3. [ ] Forecast completeness
4. [ ] User acceptance testing

**Total Estimated Effort:** 6-14 hours (depends on existing code quality)

---

## 🔧 Database Migration Required

Before testing vendor threshold blocking:

```bash
cd packages/db
pnpm exec prisma migrate dev --name add_vendor_threshold_exception
pnpm exec prisma generate
```

This creates the migration for the new `VENDOR_THRESHOLD_EXCEEDED` exception reason enum value.

---

## 📝 Key Files Modified

| File | Change | Status |
|------|--------|--------|
| `packages/shared/src/types.ts` | Added exception type | ✅ Done |
| `packages/db/prisma/schema.prisma` | Added enum value | ✅ Done |
| `apps/api/src/services/validationService.ts` | Added validation function | ✅ Done |
| `apps/api/src/services/approvalService.ts` | Added blocking check | ✅ Done |
| `apps/api/src/services/paymentExportService.ts` | NEW - Export service | 🟡 TODO |
| `apps/api/src/controllers/paymentBatch.ts` | Add export endpoint | 🟡 TODO |
| `apps/api/src/routes/paymentBatches.ts` | Add export route | 🟡 TODO |
| `apps/web/src/components/PaymentBatchApproval.tsx` | Add export button | 🟡 TODO |
| `apps/api/src/services/reportService.ts` | Update forecast queries | 🟡 TODO |
| `apps/web/src/components/Dashboard.tsx` | Update AP liability widget | 🟡 TODO |
| `apps/web/src/components/ReportView.tsx` | Add report filters | 🟡 TODO |

---

## ✨ Ready to Deploy

Once all phases complete:
- [ ] All tests passing
- [ ] UAT sign-off from Wyssa
- [ ] Documentation updated
- [ ] Migration committed
- [ ] Deployment to staging

