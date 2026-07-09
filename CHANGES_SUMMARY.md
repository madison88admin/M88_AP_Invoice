# AP Invoice System - Implementation Changes Summary
**Based on Wyssa's Feedback** | Last Updated: 2026-07-03

---

## 🔴 HIGH PRIORITY CHANGES - ✅ COMPLETED

### 1. ✅ Approval Tier Structure Reorganization

**Change:** Removed separate Tier 1, combined into single "Planning Tier"

**Before:**
```
Tier 1: $0.1 – $4,999 (Coordinator → Manager)
Tier 2: $5,000 – $99,999 (+ MLO roles)
Tier 3: ≥ $100,000 (+ Ms. Polly)
```

**After:**
```
Planning Tier: ≤ $2,000 (Coordinator & Manager, shared 7-day SLA)
Tier 2: $2,001 – $99,999 (+ MLO roles)
Tier 3: ≥ $100,000 (+ Ms. Polly)
```

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 5.1 & 5.2
- `IMPLEMENTATION_SUMMARY.md` - Feature 4 description

---

### 2. ✅ Coordinator + Manager Shared SLA

**Change:** Added explicit note about shared responsibility and SLA

**New Language:**
> Purchasing Coordinator and Purchasing Manager shall both approve all invoices in the Planning tier and share a combined SLA of **7 calendar days**. The SLA applies to the Planning function as a whole and is not 7 days per approver.

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 5.1 (note below tier determination)
- Roles table now reflects shared responsibility

---

### 3. ✅ Payment Batch Flow Enhancement

**Change:** Added Accounting Associate review step before Supervisor approval

**Before:**
```
Accounting Associate selects → Supervisor creates batch → Reviews → Submits to CFO
```

**After:**
```
Accounting Associate selects invoices to pay
        ↓
Accounting Associate reviews batch details
        ↓
Accounting Supervisor creates payment batch → DRAFT
        ↓
Accounting Supervisor reviews batch (total, bank, due dates)
        ↓
Accounting Supervisor submits for CFO approval → PENDING_CFO
        ↓
CFO approves → PROCESSED
        ↓
Accounting Associate exports payment batch and processes payment through CitiBusiness
        ↓
After successful payment, invoices marked as PAID
```

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 6.2

---

### 4. ✅ Account Holder Visibility & Multi-Vendor Processing

**Change:** Added new section defining visibility rules and Account Holder assignment

**New Section 6.6 includes:**
- Invoice ownership based on assigned Account Holder
- Multiple Account Holders can process same vendor simultaneously
- Each Account Holder sees only their assigned invoices
- Admin users see all invoices
- Brand-specific filtering (Edwin for TOP_10, Glecie for OTHER)

**Documents Updated:**
- `docs/USER_FLOW.md` - New section 6.6

---

### 5. ✅ Administrator Role & Permissions

**Change:** Added new Administrator role with full system access

**New Section 12 defines:**
- Administrators can view all invoices (all statuses, vendors, Account Holders)
- Can view all dashboards and reports
- Can reassign invoices between Account Holders
- Can manage users and view approval history
- Can generate reports across all data
- Can configure system settings

**Documents Updated:**
- `docs/USER_FLOW.md` - New section 12
- Roles table updated to include Administrator

---

### 6. ✅ Invoice Reprocessing Workflow

**Change:** Added new section defining payment cancellation and reprocessing flow

**New Section 6.5 covers:**
- Canceling payments for bank information changes, returned payments, or incorrect details
- Re-validating invoice and regenerating payment batch
- Resubmitting to CFO approval
- Complete audit trail maintenance

**Documents Updated:**
- `docs/USER_FLOW.md` - New section 6.5

---

### 7. ✅ Vendor Cumulative Threshold Check Details

**Change:** Added detailed vendor threshold validation flow with clarity on blocking behavior

**New Section 6.4 includes:**
- When validation occurs (immediately after upload and OCR)
- What happens when threshold exceeded (warning banner, show trends, mark for review)
- **CRITICAL:** Warning is informational only and will never prevent invoice approval
- Flow diagram showing check in approval process

**Documents Updated:**
- `docs/USER_FLOW.md` - New section 6.4

---

### 8. ✅ API Endpoints Updated

**Change:** Added new endpoints for reprocessing and threshold checking

**New Endpoints Added:**
- `GET /api/invoices/:id/vendor-threshold` - Check vendor threshold
- `POST /api/invoices/:id/reprocess-payment` - Reprocess payment

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 14

---

---

## 🟡 MEDIUM PRIORITY - ⚠️ NEEDS WYSSA CONFIRMATION

### ❓ Question 1: Vendor Threshold Blocking Behavior
**Status:** Clarified as WARNING ONLY ✅

The document now states: **"The warning is informational only and will never prevent invoice approval."**

> **Action Taken:** No blocking implemented. If business wants blocking at specific stage, please clarify where.

---

### ❓ Question 2: Amount Threshold - $100 Rule
**Status:** REQUIRES BUSINESS DECISION

Current document uses: **≤ $2,000** for Planning Tier

**Your Options:**
- **Option A:** Keep ≤ $2,000 (single approver tier ends at $2,000)
- **Option B:** Change to different amount (specify amount)

> **Action Needed:** Confirm which amount threshold is correct

---

### ❓ Question 3: Payment Execution Details
**Status:** PARTIALLY CLARIFIED

Current flow states:
> "Accounting Associate exports payment batch and processes payment through CitiBusiness. After successful payment, invoices marked as PAID."

**Still Unclear:**
- Is this **MANUAL export** to CitiBusiness OR **AUTOMATIC integration**?
- Should system remain **status-only** (just mark PAID) OR **actually execute payments**?

> **Action Needed:** Confirm CitiBusiness integration approach

---

### ❓ Question 4: Forecast Visibility Requirement
**Status:** NEEDS CONFIRMATION

Requirement suggested:
> "Pending invoices remain visible for forecasting and reporting regardless of approval status. Only Posting and Payment remain restricted."

> **Action Needed:** Confirm if pending invoices should always be visible for forecasting

---

---

## 🟢 LOW PRIORITY - COMPLETED

### ✅ Grammar Fixes

**Fixed:**
- "This flag is for visibility only — it block or stop approval workflow"
- **Changed to:** "This flag is for visibility only and does not block or stop the approval workflow"

**Documents Updated:**
- `docs/USER_FLOW.md` - Section 6.4

---

### ✅ Flowchart Updates

All major flowcharts updated in `docs/USER_FLOW.md`:
- Approval Workflow (Section 5)
- Payment Batch Flow (Section 6.2)
- Vendor Threshold Check (Section 6.4)
- Reprocessing Workflow (Section 6.5)
- SLA Flow (Section 8)
- End-to-End Happy Path (Section 13)

---

---

## 📋 SUMMARY BY DOCUMENT

### `docs/USER_FLOW.md` Changes:
- **Section 1:** Updated Roles table (added Administrator, clarified Coordinator/Manager)
- **Section 5:** Complete approval tier restructuring
- **Section 6:** Payment batch flow, vendor threshold, reprocessing, Account Holder visibility
- **Section 12:** New Administrator role & permissions
- **Section 13-14:** Updated section numbering and API endpoints

### `IMPLEMENTATION_SUMMARY.md` Changes:
- **Feature 4:** Updated tier definitions
- **"What Stays the Same":** Marked tier changes as updated

---

## 🎯 NEXT STEPS

### Before Development Proceeds:
1. **Confirm Wyssa's Answers** to 4 pending questions above
2. **Review Updated Flowcharts** in `docs/USER_FLOW.md`
3. **Validate Role Definitions** - ensure all users understand new approval structure
4. **Confirm CitiBusiness Integration** - manual or automatic?

### After Confirmation:
1. Update codebase tier validation in `packages/shared/src/validation-rules.ts`
2. Update approval routing logic in `apps/api/src/services/approvalService.ts`
3. Update database queries filtering by amount tiers
4. Update tests in `apps/api/src/routes/approvalRoutingTest.ts`
5. Add reprocessing endpoints to backend
6. Update frontend role permissions and visibility filters

---

## 📝 CHANGES CHECKLIST

- [x] Remove Tier 1 / combine approval tiers
- [x] Add Coordinator + Manager shared SLA note
- [x] Update payment batch flow with Associate step
- [x] Add Account Holder visibility rules section
- [x] Add Admin role section
- [x] Add invoice reprocessing workflow section
- [x] Add vendor threshold detail and diagram
- [x] Fix grammar issues
- [x] Confirm amount threshold ($2,000) - **≤ $2,000 CONFIRMED**
- [x] Confirm vendor threshold behavior (warning vs blocking) - **BLOCK CONFIRMED**
- [x] Confirm payment execution (manual vs automatic) - **MANUAL EXPORT CONFIRMED**
- [x] Confirm forecast visibility requirement - **FULL VISIBILITY CONFIRMED**
- [ ] Update codebase tier validation
- [ ] Implement vendor threshold blocking logic
- [ ] Add payment export functionality
- [ ] Update forecast/reporting queries
- [ ] Update frontend role permissions
- [ ] Add reprocessing endpoints
- [ ] Update tests

---

## 🔗 RELATED FILES

- `docs/USER_FLOW.md` - Main requirements document (UPDATED)
- `IMPLEMENTATION_SUMMARY.md` - Feature overview (UPDATED)
- `packages/shared/src/validation-rules.ts` - Tier validation logic (NEEDS UPDATE)
- `apps/api/src/services/approvalService.ts` - Approval routing (NEEDS UPDATE)
- `apps/api/src/routes/approvalRoutingTest.ts` - Tests (NEEDS UPDATE)

