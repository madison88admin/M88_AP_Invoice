# AP Invoice System - User Flow

## 1. Actors / Roles

| Role | Responsibilities |
|---|---|
| **Vendor / Supplier** | Sends invoices via email or portal |
| **Accounting Associate** | Uploads invoices, reviews OCR, posts invoices, schedules payments, creates and executes reviewed payment batches |
| **Accounting Supervisor** | Reviews exceptions and payment batches; marks batches reviewed or returns them for correction |
| **Purchasing Coordinator** | First approval for all invoices; shares approval responsibility with Purchasing Manager |
| **Purchasing Manager** | Approves all invoices; shares 7-day SLA with Purchasing Coordinator |
| **MLO Account Holder** | Approval for Tier 2+ invoices ($5,000+) — brand-specific: Edwin / Glecie |
| **MLO Planning Manager** | Approval for Tier 2+ invoices |
| **Sr. Manager Global Production** | Approval for Tier 2+ invoices |
| **Ms. Polly** | Approval for Tier 3 invoices ($100,000+) |
| **President** | Optional top-level approval |
| **Administrator** | System configuration, views all invoices/vendors, manages users, generates reports |
| **IT Admin** | System configuration, health monitoring |

---

## 2. Invoice Intake Flows

### 2.1 Email Intake
```
Vendor sends invoice PDF to intake email
        ↓
Email Intake Service (Microsoft Graph / IMAP)
        ↓
Parse attachments (PDF only)
        ↓
Store in temp storage / S3
        ↓
Create invoice record with status = RECEIVED
        ↓
Trigger OCR extraction pipeline
```

### 2.2 Manual Upload
```
Accounting Associate opens Upload Invoice Modal
        ↓
Select PDF / drag-and-drop
        ↓
Client-side validation (PDF type, size)
        ↓
Upload to API
        ↓
Server receives file
        ↓
OCR extraction pipeline starts
        ↓
Return extraction preview to frontend
```

---

## 3. OCR Extraction Flow

```
PDF uploaded
        ↓
Extract raw text with pdf2json (preserve page boundaries)
        ↓
Normalize text (fix OCR fragmentation, compact labels)
        ↓
Detect vendor / buyer
        ↓
Vendor-specific extraction (Madison rules)
        ↓
AST single-source mode (optional)
        ↓
Gemini OCR extraction (if API key configured)
        ↓
Consensus extractor compares pdf2json vs Gemini
        ↓
NextGen PO cross-check (if credentials configured)
        ↓
Resolve conflicts → ConsensusResult
        ↓
Parse PO reference → brand, season, order_type, MPO
        ↓
Extract line items and compute qty_shipped
        ↓
Return final extraction + confidence + review flag
```

### 3.1 Extraction Confidence Status
- **HIGH**: both engines agree, no review needed
- **MEDIUM**: one engine value, acceptable
- **LOW / CONFLICT**: engines disagree → review required
- **MISSING**: field not found

---

## 4. Validation & Exception Flow

```
Extraction complete
        ↓
Validation Service checks:
  - Required fields present
  - Amount within PO tolerance
  - Currency confirmed
  - Vendor match
  - PO validation
  - Duplicate detection
  - Signature rules (if applicable)
        ↓
If validation fails → create Exception
        ↓
Exception types:
  - MISSING_SIGNATURE
  - AMOUNT_MISMATCH
  - VENDOR_MISMATCH
  - PO_NOT_FOUND
  - DUPLICATE_INVOICE
  - CURRENCY_UNCONFIRMED
        ↓
Route to responsible role for resolution
```

---

## 5. Approval Workflow Flow

### 5.1 Tier Determination
```
Amount ≤ $2,000              → Planning Tier (Coordinator & Manager)
$2,001 – $99,999            → Tier 2
≥ $100,000                  → Tier 3
```

> **Note:** Purchasing Coordinator and Purchasing Manager shall both approve all invoices in the Planning tier and share a combined SLA of **7 calendar days**. The SLA applies to the Planning function as a whole and is not 7 days per approver.

### 5.2 Approval Route
```
Planning Tier (≤ $2,000): 
  Coordinator → Purchasing Manager (combined 7-day SLA)

Tier 2 ($2,001–$99,999): 
  Coordinator → Purchasing Manager (combined 7-day SLA)
                → MLO Account Holder (brand-specific: Edwin / Glecie)
                → MLO Planning Manager
                → Sr. Manager Global Production

Tier 3 (≥ $100,000): 
  Coordinator → Purchasing Manager (combined 7-day SLA)
                → MLO Account Holder (brand-specific: Edwin / Glecie)
                → MLO Planning Manager
                → Sr. Manager Global Production
                → Ms. Polly
```

### 5.3 Approval Step Flow
```
Invoice approved at current stage
        ↓
System checks if user role matches required signatory role
        ↓
If match:
  - Record signature (signatory_role, name, timestamp, type)
  - Update invoice status to next stage
  - Log audit trail
  - Reset/notify next approver
        ↓
If all required signatures complete:
  - Status = APPROVED
  - Ready for posting
        ↓
If rejected:
  - Status = REJECTED
  - Stop workflow
  - Notify submitter
```

---

## 6. Posting & Payment Flow

### 6.1 Invoice Posting
```
Status = APPROVED
        ↓
Accounting Associate posts invoice
        ↓
Generate GL entries / journal
        ↓
Status = POSTED
        ↓
Schedule for payment
```

### 6.2 Payment Batch Flow
```
Accounting Associate selects invoices to pay
        ↓
Accounting Associate reviews batch details
        ↓
Accounting Supervisor creates payment batch → DRAFT
        ↓
Accounting Supervisor reviews batch (total, bank, due dates)
        ↓
Accounting Associate submits batch → PENDING_SUPERVISOR_REVIEW
        ↓
Accounting Supervisor reviews
        ↓
Supervisor marks REVIEWED or returns it with a reason
        ↓
Accounting Associate exports and executes the reviewed batch
        ↓
System generates payment export file (CSV format compatible with CitiBusiness)
        ↓
Accounting Associate downloads export file
        ↓
Accounting Associate uploads file to CitiBusiness for payment processing
        ↓
CitiBusiness executes EFT/wire/check payments
        ↓
After successful payment confirmation, invoices marked as PAID in system
        ↓
Send remittance advice / update NextGen
```

### 6.3 CFO Rejection
```
CFO rejects batch
        ↓
Status = DRAFT (or REJECTED)
        ↓
Return to Accounting Supervisor with reason
        ↓
Supervisor fixes and resubmits
```

---

## 6.4 Vendor Cumulative Threshold Check

**Purpose:** Monitor vendor spending to prevent overpayment and catch unusual patterns by blocking invoices that exceed cumulative spend thresholds.

```
Invoice Uploaded
        ↓
OCR extraction and vendor matching complete
        ↓
Vendor cumulative threshold validation (for current month/period)
        ↓
If cumulative amount EXCEEDS threshold:
  - Display warning banner
  - Show historical spending trend
  - Mark invoice for review
  - BLOCK invoice from proceeding to approval
  - Create VENDOR_THRESHOLD_EXCEEDED exception
        ↓
Exception routing to Purchasing Coordinator
        ↓
Coordinator reviews and takes action:
  - Approve exception (override block)
  - Request revised invoice
  - Reject invoice
        ↓
If threshold NOT exceeded:
  - Approval process continues normally
```

> **Note:** The cumulative vendor threshold validation will occur immediately after invoice upload and validation. If the threshold is exceeded, invoice approval is **BLOCKED** until the Purchasing Coordinator reviews and approves the exception. The block prevents accidental overpayment and ensures vendor spending governance.

---

## 6.5 Invoice Reprocessing Workflow

**Purpose:** Allow correction and reprocessing of invoices when payment issues occur.

If payment cannot proceed due to:
- Bank information changes
- Returned payment
- Incorrect banking details

The system shall allow:
```
Cancel Payment
        ↓
Update Bank Details (Accounting Associate)
        ↓
Re-validate invoice
        ↓
Regenerate Payment Batch
        ↓
Resubmit to CFO Approval
        ↓
Reprocess Payment
        ↓
Maintain Audit Trail (all changes logged)
```

---

## 6.6 Account Holder Visibility & Multi-Vendor Processing

**Purpose:** Ensure Account Holders see only their assigned invoices while Admins have full visibility.

### Multiple Account Holder Handling
- Invoice ownership is based on the assigned **Account Holder**
- Multiple Account Holders may process invoices from the same vendor **simultaneously**
- Each Account Holder only sees invoices assigned to them
- **Admin users** may view all invoices
- Brand-specific Account Holders (Edwin for TOP_10 brands, Glecie for OTHER brands) can only see their respective brand invoices

---

## 6.7 Forecast Visibility for Pending Invoices

**Purpose:** Ensure Finance can accurately forecast AP spend regardless of approval status, while maintaining GL posting and payment restrictions.

### Visibility Rules

**Pending invoices (any status) ARE visible in:**
- Forecasting reports (cash flow projections)
- Aged AP reports (aging bucket analysis)
- Vendor balance reports (vendor payables tracking)
- Department/category spend reports
- Dashboard widgets (total AP liability)

**Pending invoices ARE NOT visible in:**
- GL (accounting records)
- Payment batches
- Remittance advice

**Restriction Logic:**
- Status RECEIVED, PENDING_APPROVAL, EXCEPTION_FLAGGED → Visible in forecasts
- Status POSTED, PAID, REJECTED → Visible in forecasts
- **Only restriction:** Cannot move to POSTED or PAID until approval complete

### Impact
Finance gets real-time visibility into committed AP spend for accurate forecasting, while operational controls remain in place (invoices must be approved before posting/payment).

---

## 7. PO Validation / Audit Flow

```
Invoice uploaded
        ↓
PO reference extracted (PO#, MPO, brand, season)
        ↓
If AST single-source mode:
  - Skip live PO validation
  - Use extraction brand only
  - PO audit runs async in background
        ↓
If not AST mode:
  - Query NextGen PO data
  - Compare qty, amount, unit price
  - Flag mismatches as exceptions
        ↓
PO audit runs async:
  - Poll /api/invoices/:id/po-status
  - Status: PENDING → COMPLETED / FAILED
        ↓
Update invoice with PO validation badge
```

---

## 8. SLA & Reminder Flow

```
Invoice enters an approval stage
        ↓
SLA timer starts (7 days for senior roles)
        ↓
SLA reminder service runs periodically
        ↓
If approaching breach:
  - Send reminder email to approver
        ↓
If breached:
  - Purchasing Manager & Sr. Manager Global Production → escalate to VP of Operations (Chris A)
  - All other stages → escalate to Accounting Supervisor
  - Mark exception as SLA_BREACH
        ↓
Audit log records SLA events
```

---

## 9. Dashboard & Reporting Flow

```
User logs in
        ↓
Role-based access control (RBAC) determines permissions
        ↓
Dashboard loads:
  - KPIs: total invoices, pending approvals, exceptions, SLA breaches
  - Invoices filtered by role (brand filter for MLO roles)
        ↓
User clicks Reports
        ↓
Reports show:
  - Approval turnaround time
  - Exception rate
  - Payment status
  - SLA compliance
```

---

## 10. Exception Resolution Flow

```
Exception created
        ↓
Route to appropriate owner based on exception type:
  - MISSING_SIGNATURE → approver
  - AMOUNT_MISMATCH → purchasing coordinator
  - VENDOR_MISMATCH → purchasing coordinator
  - PO_NOT_FOUND → purchasing coordinator
  - DUPLICATE_INVOICE → purchasing coordinator
        ↓
Owner reviews and takes action:
  - Correct data → re-validate
  - Mark as expected → add exception note
  - Reject invoice → stop workflow
        ↓
If resolved → resume approval workflow
```

---

## 11. System Health & Admin Flow

```
IT Admin opens System page
        ↓
System status endpoint returns:
  - Active roles
  - Engine health (pdf2json, Gemini, NextGen)
  - Database connection
  - Recent errors
        ↓
Admin can configure:
  - SLA limits
  - Role mappings
  - Email templates
  - API keys
```

---

## 12. Administrator Role & Permissions

### Administrator Capabilities
Administrators have unrestricted system access and can:
- **View** all invoices (all statuses, all vendors, all Account Holders)
- **View** all vendors and vendor master data
- **View** all dashboards and reports
- **View** every Account Holder queue and approval chain
- **Reassign** invoices between Account Holders
- **Manage** users (create, edit, suspend, reassign roles)
- **View** complete approval history and audit trail for all invoices
- **Generate** reports across all data
- **Configure** system settings (SLA limits, email templates, API keys)

### Administrator vs. Standard Roles
- **Standard Approvers** see only invoices assigned to their Account Holder or brand
- **Administrators** bypass all Account Holder/brand restrictions
- Administrator access is logged for audit compliance

---

## 13. End-to-End Happy Path

```
Vendor sends invoice PDF via email
        ↓
Email Intake receives and stores PDF
        ↓
OCR extracts fields (vendor, invoice#, amount, PO, MPO, line items)
        ↓
Validation passes with no exceptions
        ↓
Invoice enters approval workflow
        ↓
Coordinator approves
        ↓
Purchasing Manager approves
        ↓
MLO Account Holder approves (Tier 2+)
        ↓
MLO Planning Manager approves
        ↓
Sr. Manager Global Production approves
        ↓
Ms. Polly approves (Tier 3)
        ↓
Status = APPROVED
        ↓
Accounting Associate posts invoice
        ↓
Accounting Associate selects invoices to pay
        ↓
Accounting Supervisor creates payment batch
        ↓
CFO approves payment batch
        ↓
System generates payment export file
        ↓
Accounting Associate uploads to CitiBusiness
        ↓
Invoices marked as PAID
        ↓
Remittance advice sent to vendor
```

---

## 14. Key API Endpoints by Flow

| Flow | Endpoint |
|---|---|
| Upload invoice | `POST /api/invoices/upload` |
| Test OCR | `POST /api/invoices/test-consensus` |
| Validate invoice | `POST /api/invoices/:id/validate` |
| Check vendor threshold | `GET /api/invoices/:id/vendor-threshold` |
| Approve invoice | `POST /api/invoices/:id/approve` |
| Reject invoice | `POST /api/invoices/:id/reject` |
| Post invoice | `POST /api/invoices/:id/post` |
| Schedule payment | `POST /api/invoices/:id/schedule-payment` |
| Reprocess payment | `POST /api/invoices/:id/reprocess-payment` |
| Create payment batch | `POST /api/payment-batches` |
| Submit batch for CFO | `POST /api/payment-batches/:id/submit` |
| CFO approve batch | `POST /api/payment-batches/:id/approve` |
| PO status | `GET /api/invoices/:id/po-status` |
| System status | `GET /api/system/status` |
| Health check | `GET /health/engines` |
