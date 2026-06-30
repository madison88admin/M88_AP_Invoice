# AP Invoice System - User Flow

## 1. Actors / Roles

| Role | Responsibilities |
|---|---|
| **Vendor / Supplier** | Sends invoices via email or portal |
| **Accounting Associate** | Uploads invoices, reviews OCR, posts invoices, selects invoices for payment batch |
| **Accounting Supervisor** | Reviews exceptions, creates payment batches, submits payment batches for CFO approval |
| **Purchasing Coordinator** | First approval for all invoices |
| **Purchasing Manager** | Approval for Tier 1 invoices ($0.1-$4,999) and all higher tiers |
| **MLO Account Holder** | Approval for Tier 2+ invoices ($5,000+) — brand-specific: Edwin / Glecie |
| **MLO Planning Manager** | Approval for Tier 2+ invoices |
| **Sr. Manager Global Production** | Approval for Tier 2+ invoices |
| **Ms. Polly** | Approval for Tier 3 invoices ($100,000+) |
| **CFO** | Approves payment batches before execution |
| **President** | Optional top-level approval |
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
Amount $0.1 – $4,999   → Tier 1
$5,000 – $99,999       → Tier 2
≥ $100,000             → Tier 3
```

### 5.2 Approval Route
```
Tier 1: Coordinator → Purchasing Manager

Tier 2: Coordinator → Purchasing Manager
                → MLO Account Holder (brand-specific: Edwin / Glecie)
                → MLO Planning Manager
                → Sr. Manager Global Production

Tier 3: Coordinator → Purchasing Manager
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
Accounting Supervisor creates payment batch → DRAFT
        ↓
Review batch details (total, bank, due dates)
        ↓
Submit for CFO approval → PENDING_CFO
        ↓
CFO reviews batch
        ↓
CFO approves → PROCESSED
        ↓
Execute payments (EFT / wire / check)
        ↓
Invoices marked as PAID
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

## 12. End-to-End Happy Path

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
Payments executed
        ↓
Invoices marked as PAID
        ↓
Remittance advice sent to vendor
```

---

## 13. Key API Endpoints by Flow

| Flow | Endpoint |
|---|---|
| Upload invoice | `POST /api/invoices/upload` |
| Test OCR | `POST /api/invoices/test-consensus` |
| Validate invoice | `POST /api/invoices/:id/validate` |
| Approve invoice | `POST /api/invoices/:id/approve` |
| Reject invoice | `POST /api/invoices/:id/reject` |
| Post invoice | `POST /api/invoices/:id/post` |
| Schedule payment | `POST /api/invoices/:id/schedule-payment` |
| Create payment batch | `POST /api/payment-batches` |
| Submit batch for CFO | `POST /api/payment-batches/:id/submit` |
| CFO approve batch | `POST /api/payment-batches/:id/approve` |
| PO status | `GET /api/invoices/:id/po-status` |
| System status | `GET /api/system/status` |
| Health check | `GET /health/engines` |
