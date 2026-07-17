# AP Invoice Processing Automation System

Full-stack AP Invoice Processing Automation system for Madison 88 Business Solutions Asia Inc.

## Tech Stack

- **Frontend**: React + TypeScript + Tailwind CSS + Vite
- **Backend**: Node.js (Express) + TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Azure AD / Microsoft 365 SSO via MSAL
- **OCR**: Azure Form Recognizer (Invoice prebuilt model)
- **Email**: Microsoft Graph API
- **Storage**: SharePoint via Microsoft Graph API
- **ERP**: QuickBooks Online API (OAuth 2.0)
- **Hosting**: Azure App Service + Azure Database for PostgreSQL

## Monorepo Structure

```
AP Invoice/
├── apps/
│   ├── api/          # Express backend (Node + TypeScript)
│   └── web/          # React frontend
├── packages/
│   ├── db/           # Prisma schema + migrations + seed data
│   └── shared/       # TypeScript types, enums, validation rules
├── package.json
└── turbo.json
```

## Sprint 1 Completed

- ✅ Prisma schema with all models (Invoice, Vendor, Signature, AuditLog, Exception, PaymentBatch)
- ✅ Vendor seed data with known aliases from Vendor Master List
- ✅ Express app scaffolding with TypeScript and basic middleware
- ✅ MSAL auth middleware and role-based route guards
- ✅ Invoice CRUD endpoints (POST, GET, PATCH)
- ✅ React Dashboard screen with Invoice table

## Sprint 2 Completed

**Backend (OCR & Intake):**
- ✅ Azure Form Recognizer OCR service integration with prebuilt invoice model
- ✅ OCR field mapping logic (Form Recognizer → Invoice schema)
- ✅ Custom field extraction (payment terms, incoterm, category, urgent flag)
- ✅ Bank field parsing from remittance section
- ✅ Invoice type detection from document header
- ✅ Invoice upload endpoint (POST /api/invoices/upload) with multer for file handling
- ✅ OCR confirmation endpoint (POST /api/invoices/:id/confirm-ocr)
- ✅ Vendor matching logic with fuzzy matching (exact, alias, Levenshtein distance, partial token)
- ✅ Vendor suggestions endpoint (GET /api/vendors/suggestions)
- ✅ Microsoft Graph API email intake service with polling mechanism
- ✅ Email intake poller endpoint (POST /api/email-intake/start-poller)

**Frontend (Upload):**
- ✅ Invoice Upload screen with drag-and-drop file upload
- ✅ OCR result preview with editable fields
- ✅ Vendor selection dropdown with confidence scores
- ✅ Manual vendor assignment when auto-matching fails
- ✅ Success confirmation with navigation back to dashboard
- ✅ React Router integration for navigation between Dashboard and Upload screens

## Setup Instructions

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- PostgreSQL database
- Azure Form Recognizer resource (endpoint + API key)
- Microsoft Graph API credentials (client ID, client secret, tenant ID)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp packages/db/prisma/.env.example packages/db/prisma/.env
cp apps/api/.env.example apps/api/.env
```

3. Configure your environment variables:
   - Database URL in `packages/db/prisma/.env`
   - Azure Form Recognizer credentials in `apps/api/.env`
   - Microsoft Graph API credentials in `apps/api/.env`
   - JWT secret in `apps/api/.env`

4. Run database migrations:
```bash
npm run db:push
```

5. Seed the database with vendor data:
```bash
npm run db:seed
```

6. Generate Prisma client:
```bash
npm run db:generate
```

### Running the Application

**Development mode:**
```bash
# Start API server (port 3001)
cd apps/api
npm run dev

# Start web app (port 3000)
cd apps/web
npm run dev
```

**Production build:**
```bash
npm run build
```

## Database Schema

### Models

- **Invoice**: Main invoice record with OCR data, status, and relationships
- **Vendor**: Vendor master list with bank details and name aliases
- **Signature**: Signature records for approval workflow
- **AuditLog**: Immutable audit trail for all invoice actions
- **Exception**: Validation exceptions with resolution tracking
- **PaymentBatch**: Payment batch management for wire transfers

### Enums

- **InvoiceType**: INV, PI, CI, SI, PREPAID
- **InvoiceCategory**: TRIMS, YARN, SAMPLE_CHARGES, SHIPPING_FREIGHT, LAB_TESTING, PROFESSIONAL_FEE, OTHER
- **InvoiceStatus**: PENDING_VALIDATION, VALIDATED, EXCEPTION, PENDING_APPROVAL, APPROVED, REJECTED, POSTED, PAYMENT_INITIATED, PAID
- **SignatureRole**: COORDINATOR, MANAGER, PLANNING_MANAGER, LINDSEY
- **ExceptionReason**: INVALID_BILL_TO, BANK_MISMATCH, MISSING_SIGNATURE, DUPLICATE_INVOICE, NEXTGEN_MISMATCH, INVALID_TEMPLATE, LATE_SUBMISSION, AMOUNT_MISMATCH, URGENT_PAYMENT
- **PaymentBatchStatus**: DRAFT, PENDING_SUPERVISOR_REVIEW, RETURNED_FOR_CORRECTION, REVIEWED, EXPORTED_TO_BANK, PROCESSING, PROCESSED, PARTIALLY_PAID, FAILED, CANCELLED

## API Endpoints

### Invoices

- `POST /api/invoices/upload` - Upload invoice file for OCR processing
- `POST /api/invoices/:id/confirm-ocr` - Confirm OCR results and create invoice
- `POST /api/invoices` - Create invoice record
- `GET /api/invoices` - List with filters: status, vendor, date, type, category
- `GET /api/invoices/:id` - Get invoice + audit trail + signatures + exceptions
- `PATCH /api/invoices/:id/status` - Update status
- `POST /api/invoices/:id/validate` - Validate invoice against rules
- `POST /api/invoices/:id/request-approval` - Request approval for validated invoice
- `POST /api/invoices/:id/approve` - Approve invoice
- `POST /api/invoices/:id/reject` - Reject invoice
- `POST /api/invoices/:id/post` - Post approved invoice to accounting
- `POST /api/invoices/:id/schedule-payment` - Schedule payment for posted invoice

### Vendors

- `GET /api/vendors/suggestions?search=...&limit=...` - Get vendor suggestions with confidence scores

### Email Intake

- `POST /api/email-intake/start-poller` - Start email polling service

### Approvals

- `GET /api/approvals/pending` - Get pending approvals for current user

### Exceptions

- `GET /api/exceptions/pending` - Get pending exceptions for current user
- `GET /api/exceptions/invoice/:invoiceId` - Get exceptions for specific invoice
- `POST /api/exceptions/:exceptionId/resolve` - Resolve exception with resolution
- `POST /api/exceptions/:exceptionId/waive` - Waive exception with reason

### Payments

- `GET /api/payments/scheduled` - Get scheduled payments
- `POST /api/payments/:paymentId/process` - Process scheduled payment

### Reports

- `GET /api/reports/invoice-volume` - Get invoice volume report
- `GET /api/reports/payment-status` - Get payment status report
- `GET /api/reports/vendor-spending` - Get vendor spending report
- `GET /api/reports/exception-rate` - Get exception rate report
- `GET /api/reports/kpi` - Get KPI metrics

### Payment Batches

- `GET /api/payment-batc8es` - Get all payment batches
- `GET /api/payment-batches/:batchId` - Get payment batch by ID
- `POST /api/payment-batches` - Create payment batch
- `POST /api/payment-batches/:batchId/process` - Process payment batch
- `POST /api/payment-batches/:batchId/cancel` - Cancel payment batch

## Frontend Screensing
- **Reports & Analytics**: KPI Dashboard, Invoice Volume chart, Payment Status chart, Vendor Spending chart, Excepto Rate chart
- **Accountin Review**: Posted invoices list, Invoice detail panel, Audit trail, Search and filter

### Completed (Sprint 1-7)

- **Dashboard**: KPI cards, Invoice table with filters, Invoice detail panel, Validation results, Approval actions, Posting actions
- **Invoice Upload**: Drag-and-drop file upload, OCR preview, Vendor selection
- **Approval Inbox**: Pending approvals list, Approve/Reject actions, Approval progress tracking
- **Exception Manager**: Pending exceptions list, Resolve/Waive actions, Exception detail tracking
- **Payment Batch Manager**: Batch list, Process/Cancel actions, Payment detail tracking

### To be implemented (Sprint 8)

- Reports (Finance / Accounting / Management)

## Validation Rules Engine

8 validation rules implemented in Sprint 3:

1. Bill-to validation - Checks if bill-to matches Madison 88
2. Invoice template validation - Validates invoice format
3. Bank details validation - Verifies bank details match vendor records
4. Signature validation - Checks for required signatures
5. Duplicate detection - Identifies duplicate invoice numbers
6. Late submission detection - Flags invoices submitted after due date
7. Urgent payment detection - Flags urgent payment requests
8. Currency and amount validation - Validates currency format and amount consistency

## Approval Routing Rules

- amount < 5,000 → PURCHASING_MANAGER
- 5,000 ≤ amount < 500,000 → PRESIDENT
- amount ≥ 500,000 → CFO

All approvals require ACCOUNTING_SUPERVISOR endorsement before posting.

## Sprint 3 Completed

**Backend (Validation):**
- ✅ Validation rules engine with 8 validation rules (bill-to, template, bank, signature, duplicate, late submission, urgent payment, currency/amount)
- ✅ Validation service with rule execution and exception creation
- ✅ Validation endpoint (POST /api/invoices/:id/validate)
- ✅ Exception management workflow with resolution tracking
- ✅ Auto-creation of approval request when validation passes

**Frontend (Validation):**
- ✅ Validation results display in invoice detail panel
- ✅ Exception list with resolution status
- ✅ Validate button for PENDING_VALIDATION invoices
- ✅ Visual feedback for validation pass/fail

## Sprint 4 Completed

**Backend (Approval Workflow):**
- ✅ Approval service with routing logic based on amount thresholds
- ✅ Approval request endpoint (POST /api/invoices/:id/request-approval)
- ✅ Approve endpoint (POST /api/invoices/:id/approve)
- ✅ Reject endpoint (POST /api/invoices/:id/reject)
- ✅ Pending approvals endpoint (GET /api/approvals/pending)
- ✅ Sequential approval chain with status tracking
- ✅ Audit log entries for all approval actions

**Frontend (Approval):**
- ✅ Approval Inbox screen with pending approvals list
- ✅ Invoice detail panel showing approval progress
- ✅ Approve and Reject buttons for PENDING_APPROVAL invoices
- ✅ Reject modal with reason input
- ✅ Approval status indicators (approved, pending, rejected)
- ✅ "Approvals" button in Dashboard header for navigation

## Sprint 5 Completed

**Backend (Posting & Payment):**
- ✅ Posting service for approved invoices with GL account determination
- ✅ Posting endpoint (POST /api/invoices/:id/post)
- ✅ Payment scheduling service with payment record creation
- ✅ Payment scheduling endpoint (POST /api/invoices/:id/schedule-payment)
- ✅ Payment processing service with simulated banking integration
- ✅ Payment processing endpoint (POST /api/payments/:paymentId/process)
- ✅ Scheduled payments endpoint (GET /api/payments/scheduled)
- ✅ Audit log entries for posting and payment actions

**Frontend (Posting & Payment):**
- ✅ Post button for APPROVED invoices
- ✅ Schedule Payment button for POSTED invoices
- ✅ Payment scheduling modal with date picker
- ✅ Loading states for posting actions
- ✅ Invoice data refresh after posting and payment scheduling

## Sprint 6 Completed

**Backend (Exception Management):**
- ✅ Exception resolution service with status tracking
- ✅ Exception resolution endpoint (POST /api/exceptions/:exceptionId/resolve)
- ✅ Exception waiver endpoint (POST /api/exceptions/:exceptionId/waive)
- ✅ Pending exceptions endpoint (GET /api/exceptions/pending)
- ✅ Invoice exceptions endpoint (GET /api/exceptions/invoice/:invoiceId)
- ✅ Auto-update invoice status when all exceptions resolved
- ✅ Audit log entries for exception resolution and waiver

**Frontend (Exception Management):**
- ✅ Exception Manager screen with pending exceptions list
- ✅ Exception detail panel showing invoice information
- ✅ Resolve exception modal with resolution input
- ✅ Waive exception modal with waiver reason input
- ✅ Exceptions button in Dashboard header for navigation
- ✅ Status indicators for pending, resolved, and waived exceptions

## Sprint 7 Completed

**Backend (Payment Batch Management):**
- ✅ Payment batch service for grouping scheduled payments
- ✅ Payment batch creation endpoint (POST /api/payment-batches)
- ✅ Payment batch retrieval endpoints (GET /api/payment-batches, GET /api/payment-batches/:batchId)
- ✅ Payment batch processing endpoint (POST /api/payment-batches/:batchId/process)
- ✅ Payment batch cancellation endpoint (POST /api/payment-batches/:batchId/cancel)
- ✅ Auto-update payment and invoice status on batch processing
- ✅ Audit log entries for batch creation, processing, and cancellation

**Frontend (Payment Batch Management):**
- ✅ Payment Batch Manager screen with batch list
- ✅ Batch detail panel showing payment information
- ✅ Process batch button for PENDING batches
- ✅ Cancel batch modal with reason input
- ✅ Payment Batches button in Dashboard header for navigation
- ✅ Status indicators for PENDING, PROCESSING, COMPLETED, and CANCELLED batches

## Sprint 8 (Next Steps)

- QuickBooks Online integration for ERP posting
- Reports and dashboard analytics
- Accounting review screen

## License

Proprietary - Madison 88 Business Solutions Asia Inc.
# AP_Invoice
