# ✅ FINAL DECISIONS CONFIRMED - 4/4 Items

**All items approved by business stakeholder - Ready for Development**

---

## 1️⃣ Vendor Threshold Blocking Behavior

### ✅ FINAL DECISION: **BLOCK INVOICES**

**Implementation:**
- Invoices exceeding cumulative vendor threshold are **BLOCKED** from approval
- Creates `VENDOR_THRESHOLD_EXCEEDED` exception
- Routes to **Purchasing Coordinator** for review
- Coordinator can:
  - **Approve Exception** → Override block and allow approval
  - **Request Revision** → Ask vendor for new invoice
  - **Reject Invoice** → Stop workflow

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 6.4 now shows blocking flow with exception routing

**Code Changes Needed:**
- `apps/api/src/services/validationService.ts` - Add threshold check before approval gate
- `apps/api/src/controllers/exceptions.ts` - Add VENDOR_THRESHOLD_EXCEEDED exception type
- `apps/web/src/components/InvoiceList.tsx` - Show blocked state with reason

---

## 2️⃣ Amount Threshold for Planning Tier

### ✅ FINAL DECISION: **≤ $2,000 - CONFIRMED**

**Approval Structure:**
```
Planning Tier ≤ $2,000:
  Coordinator → Purchasing Manager
  (Shared 7-day SLA)

Tier 2: $2,001 – $99,999:
  (+ MLO approvers)

Tier 3: ≥ $100,000:
  (+ Ms. Polly)
```

**Code Impact:** No changes needed - already implemented in codebase

---

## 3️⃣ Payment Execution Method

### ✅ FINAL DECISION: **MANUAL EXPORT (Status-Only)**

**Flow:**
```
CFO Approves Batch
    ↓
System generates payment export (CSV format)
    ↓
Accounting Associate downloads export file
    ↓
Accounting Associate uploads to CitiBusiness
    ↓
CitiBusiness executes payments (external system)
    ↓
Associate confirms payment in system
    ↓
System marks invoices as PAID
```

**Benefits:**
- No API integration required
- Easy to implement
- Manual confirmation prevents accidental payments
- Maintains audit trail

**Code Changes Needed:**
- `apps/api/src/services/paymentBatchService.ts` - Add payment export generation
- `apps/api/src/controllers/paymentBatch.ts` - Create export download endpoint
- `apps/web/src/components/PaymentBatchApproval.tsx` - Add export button and confirmation flow

**New Endpoint:**
- `GET /api/payment-batches/:id/export` - Download payment export file

---

## 4️⃣ Forecast Visibility for Pending Invoices

### ✅ FINAL DECISION: **FULL VISIBILITY**

**Visible in Forecasting:**
- All pending invoices appear in cash flow projections
- Included in aged AP reports
- Shown in vendor balance reports
- Visible in department/category spend reports
- Included in dashboard AP liability widgets

**NOT Visible in:**
- GL entries (until POSTED)
- Payment batches (until APPROVED)
- Remittance advice (until PAID)

**Status Visibility:**
- RECEIVED, PENDING_APPROVAL, EXCEPTION_FLAGGED → **Visible**
- POSTED, PAID, REJECTED → **Visible**
- Only restriction: Cannot be POSTED/PAID until approval complete

**Benefits:**
- Finance gets real-time AP forecasting visibility
- Improved cash flow accuracy
- Better vendor payables tracking
- No operational risk (posting/payment still restricted)

**Code Changes Needed:**
- `apps/api/src/services/reportService.ts` - Update forecast queries to include pending invoices
- `apps/web/src/components/ReportDashboard.tsx` - Show pending invoices in forecast view
- `apps/api/src/routes/reports.ts` - Add pending invoice inclusion filter

**New Filter:**
- Forecasting queries: Include `WHERE status NOT IN ('REJECTED')`

---

## 📋 FINAL CONFIRMATION SUMMARY

```
1. Vendor Threshold Blocking: ✅ BLOCK
   - Coordinator approval required to override

2. Planning Tier Threshold: ✅ ≤ $2,000 CONFIRMED
   - No code changes needed

3. Payment Execution: ✅ MANUAL EXPORT (Status-Only)
   - CSV export for CitiBusiness upload
   - Manual confirmation workflow

4. Forecast Visibility: ✅ FULL VISIBILITY
   - All pending invoices visible in forecasts
   - Posting/payment still restricted
```

---

## 🚀 DEVELOPMENT ROADMAP

### Phase 1: Vendor Threshold Blocking (High Priority)
**Effort:** 4-6 hours
- Add validation check in approvalService
- Create VENDOR_THRESHOLD_EXCEEDED exception
- Update exception routing rules
- Add UI blocking indicator
- Write tests

### Phase 2: Payment Export (High Priority)
**Effort:** 6-8 hours
- Create payment batch export service (CSV generation)
- Add export download endpoint
- Create UI export button with progress indicator
- Add payment confirmation workflow
- Write tests

### Phase 3: Forecast Visibility (Medium Priority)
**Effort:** 4-6 hours
- Update report queries to include pending invoices
- Update dashboard AP liability calculation
- Add aging report filtering
- Update vendor balance queries
- Write tests

### Phase 4: Testing & QA
**Effort:** 6-8 hours
- End-to-end testing of all flows
- Threshold edge cases
- Payment export/import verification
- Forecast accuracy validation
- User acceptance testing

**Total Development Estimate:** 20-28 hours (2.5-3.5 days for 1 developer)

---

## ✅ READY FOR DEVELOPMENT

All business decisions confirmed. Proceeding with:
1. Update codebase tier validation (if needed)
2. Implement vendor threshold blocking logic
3. Add payment export functionality
4. Update forecast/reporting visibility
5. Write comprehensive tests



