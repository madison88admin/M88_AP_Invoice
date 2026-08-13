# AP Invoice Automation System
## User Manual

**Version:** 2.0  
**Last Updated:** July 31, 2026  
**Organization:** Madison 88  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Getting Started](#2-getting-started)
3. [User Roles & Permissions](#3-user-roles--permissions)
4. [Dashboard](#4-dashboard)
5. [Invoice Repository](#5-invoice-repository)
6. [Upload Invoice](#6-upload-invoice)
7. [Approvals](#7-approvals)
8. [Exceptions Management](#8-exceptions-management)
9. [On-Hold Queue](#9-on-hold-queue)
10. [Payment Batches](#10-payment-batches)
11. [Accounting Review](#11-accounting-review)
12. [Vendor Management](#12-vendor-management)
13. [Reports](#13-reports)
14. [SLA Analytics](#14-sla-analytics)
15. [Extraction Analytics](#15-extraction-analytics)
16. [Audit Logs](#16-audit-logs)
17. [User Management](#17-user-management)
18. [System Configuration](#18-system-configuration)
19. [Notifications](#19-notifications)
20. [Invoice Workflow & Status Flow](#20-invoice-workflow--status-flow)
21. [Troubleshooting](#21-troubleshooting)

---

## 1. System Overview

The AP Invoice Automation System is a comprehensive web-based platform that automates the accounts payable invoice processing workflow for Madison 88. It handles:

- **OCR-based invoice extraction** from PDF files
- **Multi-stage approval workflow** with role-based signatories
- **PO validation** against NextGen MPO data
- **Exception handling** for discrepancies
- **Payment batch management** and scheduling
- **Bank detail change tracking** with approval workflow
- **Vendor management** with bank detail verification
- **SLA tracking** and analytics
- **Audit logging** for compliance

### System Architecture

- **Frontend:** React + TypeScript (Vite)
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL (Supabase)
- **OCR Engine:** Ollama (qwen3:14b model)
- **External Integration:** NextGen (AVPS) for PO/MPO validation

### Access

- **Web Application:** `http://localhost:5173` (local) or deployed URL
- **API Server:** `http://localhost:3001` (local) or `http://5.223.78.194:3001` (VPS)

---

## 2. Getting Started

### 2.1 Login Page

![Login Page](screenshots/01-login.png)

The login page features:
- **Email field** — Enter your registered email address
- **Password field** — Enter your password (click the eye icon to toggle visibility)
- **Quick Login buttons** — One-click login for demo accounts (Maryan, Edwin, Glecie, Lindsey, Polly)
- **"Invalid email or password"** error message appears if credentials are incorrect

### 2.2 How to Log In

1. Open the web application in your browser
2. Enter your email address (e.g., `pamela@madison88.com`)
3. Enter your password (e.g., `madison88`)
4. Click the **Sign In** button or press Enter
5. You will be redirected to the Dashboard

### 2.3 How to Log Out

1. Click your profile avatar in the top-right corner of the sidebar
2. Click **Logout**
3. You will be returned to the login page

### 2.4 Browser Notifications

When you first log in, your browser may ask permission to show notifications:
- Click **Allow** to receive system notifications when you're away from the tab
- Notifications appear in your OS notification center when new invoice events occur
- Clicking a notification brings you back to the application

---

## 3. User Roles & Permissions

The system supports the following roles, each with different permissions:

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **SUPERADMIN** | System administrator (JC) | Manage users, system config, view audit logs |
| **IT_ADMIN** | IT support | Full access to all modules |
| **PURCHASING_COORDINATOR** | Validates and processes invoices | Upload, validate, approve/reject, request approval |
| **PURCHASING_MANAGER** | Manages purchasing team | Approve/reject, view team performance, escalate |
| **ACCOUNTING_ASSOCIATE** | Posts invoices to QuickBooks | Post, schedule payments, manage batches, edit invoices |
| **ACCOUNTING_SUPERVISOR** | Oversees accounting operations | Approve/reject, post, view all invoices, reports |
| **MLO_ACCOUNT_HOLDER** | Brand-level approver | Approve/reject brand-filtered invoices |
| **PLANNING_MANAGER** | Brand-scoped planning | Approve/reject brand-filtered invoices |
| **SR_MANAGER_GLOBAL_PRODUCTION** | Senior production manager | Approve/reject, view production costs, reports |
| **MS_POLLY** | Executive approval | Approve/reject high-value invoices, executive summary |

### Role to Sidebar Mapping

| Sidebar Section | Visible To |
|----------------|------------|
| **Overview** → Dashboard | All users |
| **Overview** → Invoice Repository | All users |
| **Overview** → Upload Invoice | Purchasing Coordinator, Accounting Associate, IT Admin |
| **Workflow** → Approvals | Coordinator, Manager, Planning Mgr, Sr Manager, Ms Polly, Accounting Supervisor |
| **Workflow** → Exceptions | Coordinator, Manager, IT Admin |
| **Workflow** → On-Hold Queue | Accounting Supervisor, Accounting Associate, IT Admin |
| **Accounting** → Payment Batches | Accounting Associate, Accounting Supervisor, IT Admin |
| **Accounting** → Accounting Review | Accounting Associate, Accounting Supervisor, IT Admin |
| **Accounting** → Vendors | Accounting Supervisor, Accounting Associate, IT Admin |
| **Analytics** → Reports | Purchasing Manager, Accounting Supervisor, IT Admin, Accounting Associate |
| **Analytics** → SLA Analytics | Accounting Supervisor, IT Admin, Accounting Associate |
| **Analytics** → Extraction Analytics | Purchasing Coordinator, IT Admin, Accounting Supervisor |
| **Admin** → Audit Logs | Accounting Supervisor, IT Admin, Accounting Associate |
| **Admin** → User Management | IT Admin, SuperAdmin |
| **Admin** → System Configuration | IT Admin, SuperAdmin |

---

## 4. Dashboard

![Dashboard](screenshots/02-dashboard.png)

The Dashboard is the main landing page after login. It provides an overview of the current invoice processing status.

### 4.1 Key Metrics Cards

At the top of the dashboard, you'll see summary cards:

- **Total Invoices** — Total number of invoices in the system
- **Pending Approval** — Invoices waiting for approval action
- **Exceptions** — Invoices with validation exceptions
- **Posted to QB** — Invoices successfully posted to QuickBooks
- **SLA Compliance** — Percentage of invoices processed within SLA

### 4.2 Invoice Table

The main table shows invoices with columns:
- **Invoice Number** — Vendor invoice number
- **Vendor** — Vendor name
- **Amount** — Invoice total amount
- **Status** — Current workflow status (color-coded badge)
- **SLA Timer** — Countdown showing time remaining for SLA
- **Created Date** — When the invoice was uploaded

### 4.3 Filters

![Dashboard Filters](screenshots/03-filters.png)

- **Status filter** — Filter by invoice status (dropdown)
- **Search bar** — Search by invoice number, vendor name, or PO number
- **Vendor filter** — Filter by specific vendor (advanced filters)
- **Date range** — Filter by creation date
- **Clear filters** — Reset all filters to default

### 4.4 Invoice Detail Modal

![Invoice Detail](screenshots/04-invoice-detail.png)

Click any invoice row to open the detail modal:

- **Invoice header info** — Number, date, vendor, amount, PO number
- **Line items** — Itemized invoice lines with quantities and amounts
- **OCR confidence** — Extraction confidence score
- **Approval chain** — Visual timeline of approvals
- **Action buttons** (role-dependent):
  - **Approve** — Approve the invoice
  - **Reject** — Reject with reason (modal)
  - **Return to Previous Approver** — Send back with reason (modal)
  - **Edit** — Edit invoice fields
  - **Post to QB** — Post to QuickBooks
  - **Schedule Payment** — Set payment date
  - **Delete** — Delete invoice (with confirmation modal)
  - **Re-extract OCR** — Re-run OCR extraction
  - **Download PDF** — Download the original PDF

### 4.5 Toast Notifications

Small notification popups appear at the bottom-right corner:
- **Green** — Success messages
- **Red** — Error messages
- **Amber** — Warning messages
- **Purple** — Info messages

Notifications auto-dismiss after 3-4 seconds.

---

## 5. Invoice Repository

![Invoice Repository](screenshots/05-repository.png)

The Invoice Repository is a comprehensive archive of all invoices in the system.

### Features:
- **Advanced filtering** — By status, vendor, date range, amount range
- **Search** — By invoice number, vendor, PO number
- **Sort** — Click column headers to sort
- **Export** — Download filtered results as CSV
- **Pagination** — Navigate through large result sets
- **Quick view** — Click any invoice to see details
- **Bulk actions** — Select multiple invoices for batch operations

---

## 6. Upload Invoice

![Upload Invoice](screenshots/06-upload.png)

**Available to:** Purchasing Coordinator, Accounting Associate, IT Admin

### 6.1 How to Upload

1. Navigate to **Upload Invoice** from the sidebar
2. Drag and drop a PDF file into the upload area, or click to browse
3. The system will automatically:
   - Extract text using OCR (Ollama qwen3:14b)
   - Parse invoice fields (number, date, vendor, amount, line items)
   - Validate against NextGen MPO data
   - Create the invoice record
4. Review the extracted data in the preview
5. Click **Confirm** to save or **Edit** to correct fields

### 6.2 Auto-Processing

Invoices placed in the `incoming-invoices/` folder on the server are automatically:
- Picked up by the File Watcher service (every 30 seconds)
- Processed through OCR extraction
- Validated against PO data
- Routed to the Purchasing Coordinator for validation

### 6.3 Supported Formats
- PDF files (recommended)
- PNG/JPEG images (single-page invoices)

---

## 7. Approvals

![Approvals](screenshots/07-approvals.png)

**Available to:** Coordinator, Manager, Planning Mgr, Sr Manager, Ms Polly, Accounting Supervisor

### 7.1 Approval Inbox

The Approvals page shows invoices pending your approval action:

- **Pending count badge** — Number of invoices awaiting your action
- **Filter by status** — Show only specific approval stages
- **Invoice cards** — Each shows vendor, amount, PO number, and SLA timer

### 7.2 How to Approve

1. Click on an invoice to open the detail modal
2. Review the invoice details, line items, and PO validation
3. Click **Approve** to approve the invoice
4. The invoice moves to the next approval stage

### 7.3 How to Reject

1. Click on an invoice to open the detail modal
2. Click **Reject**
3. A modal appears — enter the rejection reason
4. Click **Confirm Rejection**
5. The invoice is sent back to the Purchasing Coordinator

### 7.4 Return to Previous Approver

1. Open the invoice detail modal
2. Click **Return to Previous Approver**
3. A modal appears — enter the reason for return
4. Click **Return Invoice**
5. The invoice goes back to the previous approver in the chain

---

## 8. Exceptions Management

![Exceptions](screenshots/08-exceptions.png)

**Available to:** Coordinator, Manager, IT Admin

### 8.1 What are Exceptions?

Exceptions are validation issues detected during invoice processing:
- **Amount mismatch** — Invoice amount doesn't match PO
- **Quantity variance** — Quantities exceed PO limits
- **Missing PO** — No matching PO found in NextGen
- **Vendor mismatch** — Invoice vendor doesn't match PO vendor
- **Duplicate invoice** — Same invoice number already exists

### 8.2 Handling Exceptions

1. Navigate to **Exceptions** from the sidebar
2. Review the list of invoices with exceptions
3. Click an invoice to see exception details
4. Take action:
   - **Resolve** — Fix the issue and re-validate
   - **Override** — Approve despite the exception (requires reason)
   - **Escalate** — Send to a manager for review
   - **Reject** — Reject the invoice

---

## 9. On-Hold Queue

![On-Hold Queue](screenshots/09-onhold.png)

**Available to:** Accounting Supervisor, Accounting Associate, IT Admin

### 9.1 What is the On-Hold Queue?

Invoices can be placed on hold for various reasons:
- **Missing documentation** — Awaiting additional documents
- **Vendor verification** — Bank details need verification
- **Internal review** — Awaiting internal clarification
- **Payment hold** — Temporary payment suspension

### 9.2 Managing Held Invoices

1. Navigate to **On-Hold Queue**
2. View all held invoices with hold reasons
3. Click an invoice to see details
4. **Release hold** — Remove the hold and resume processing
5. **Update reason** — Modify the hold reason
6. **Add note** — Add internal notes about the hold

---

## 10. Payment Batches

![Payment Batches](screenshots/10-payment-batches.png)

**Available to:** Accounting Associate, Accounting Supervisor, IT Admin

### 10.1 Creating a Payment Batch

1. Navigate to **Payment Batches**
2. Click **Create Batch**
3. Select invoices to include in the batch
4. Set the payment date
5. Click **Create**
6. The batch is created in DRAFT status

### 10.2 Batch Statuses

- **DRAFT** — Being assembled, can add/remove invoices
- **READY** — Ready for approval
- **APPROVED** — Approved for payment
- **PAID** — Payment confirmed
- **CANCELLED** — Batch cancelled

### 10.3 Vendor & Currency Filters

- Filter batches by vendor
- Filter by currency
- View total amount per batch
- Export batch summary

---

## 11. Accounting Review

![Accounting Review](screenshots/11-accounting-review.png)

**Available to:** Accounting Associate, Accounting Supervisor, IT Admin

### 11.1 Tabs

The Accounting Review page has three tabs:

#### Posted Invoices
- View invoices posted to QuickBooks
- Verify posting details
- Download posting confirmations

#### Statement of Account (SOA)
- View vendor SOA invoices
- Match SOA against individual invoices

#### Bank Change Requests
- Review pending bank detail change requests
- **Approve** — Apply the change to the invoice
- **Reject** — Reject the change request
- View requested field, old value, and new value

### 11.2 Bank Change Approval

When a bank detail change is requested:
1. Navigate to **Accounting Review** → **Bank Change Requests** tab
2. Review the request: vendor, invoice, field being changed, old/new values
3. Click **Approve** (green checkmark) to apply the change
4. Click **Reject** (red X) to deny the change
5. A toast notification confirms the action

---

## 12. Vendor Management

![Vendor Management](screenshots/12-vendors.png)

**Available to:** Accounting Supervisor, Accounting Associate, IT Admin

### 12.1 Vendor List

- **Search** — Search by vendor name or alias
- **Vendor cards** — Show name, classification, bank verification status
- **Bank verified badge** — Indicates if bank details have been verified
- **Invoice count** — Number of invoices from this vendor

### 12.2 Vendor Details

Click a vendor to see:
- **Bank details** — Bank name, account number, SWIFT code, IBAN
- **Alternative bank details** — Multiple bank accounts if applicable
- **Invoice history** — All invoices from this vendor
- **Verification status** — When bank details were last verified

### 12.3 Adding a Vendor

1. Click **Add Vendor**
2. Fill in vendor name, classification, and bank details
3. Click **Save**
4. The vendor is created and available for invoice processing

---

## 13. Reports

![Reports](screenshots/13-reports.png)

**Available to:** Purchasing Manager, Accounting Supervisor, IT Admin, Accounting Associate

### Report Types:

- **Processing Summary** — Total invoices processed, approval times
- **Exception Report** — Exceptions by type, resolution time
- **Vendor Spend Report** — Total spend per vendor
- **SLA Compliance Report** — On-time vs. late processing
- **Approval Cycle Time** — Average time at each approval stage
- **Export** — Download reports as CSV/PDF

---

## 14. SLA Analytics

![SLA Analytics](screenshots/14-sla-analytics.png)

**Available to:** Accounting Supervisor, IT Admin, Accounting Associate

### Features:

- **SLA countdown timers** — Real-time countdown for each invoice
- **Compliance rate** — Percentage of invoices within SLA
- **Bottleneck analysis** — Identify stages causing delays
- **Average processing time** — Per stage and overall
- **Trend charts** — SLA performance over time
- **Color-coded indicators** — Green (on track), Amber (warning), Red (breached)

---

## 15. Extraction Analytics

![Extraction Analytics](screenshots/15-extraction-analytics.png)

**Available to:** Purchasing Coordinator, IT Admin, Accounting Supervisor

### Features:

- **OCR confidence scores** — Average extraction confidence
- **Field accuracy** — Per-field extraction success rate
- **Processing time** — OCR extraction duration
- **Volume trends** — Invoices processed over time
- **Error analysis** — Common extraction errors
- **Re-extraction tracking** — How often OCR is re-run

---

## 16. Audit Logs

![Audit Logs](screenshots/16-audit-logs.png)

**Available to:** Accounting Supervisor, IT Admin, Accounting Associate

### What is Logged:

- **USER_LOGIN** — User login events
- **USER_CREATED** — New user created
- **USER_UPDATED** — User details changed
- **USER_DELETED** — User deleted
- **INVOICE_APPROVED** — Invoice approved
- **INVOICE_REJECTED** — Invoice rejected
- **INVOICE_POSTED** — Invoice posted to QuickBooks
- **INVOICE_RETURNED** — Invoice returned to previous approver
- **INVOICE_DELETED** — Invoice deleted
- **BANK_CHANGE_APPROVED** — Bank change request approved
- **BANK_CHANGE_REJECTED** — Bank change request rejected
- **PAYMENT_SCHEDULED** — Payment scheduled
- **EXCEPTION_RESOLVED** — Exception resolved
- **EXCEPTION_ESCALATED** — Exception escalated

### Filtering:
- Filter by action type
- Filter by user
- Filter by date range
- Export logs as CSV

---

## 17. User Management

![User Management](screenshots/17-user-management.png)

**Available to:** IT Admin, SuperAdmin only

### 17.1 User List

- **Stats summary** — Total users, active, inactive, admin count
- **Search** — Search by name, email, or role
- **User cards** — Show name, email, role, active status, creation date
- **Role color coding** — Each role has a distinct color

### 17.2 Adding a User

1. Click **Add User** (top-right)
2. Fill in the modal:
   - **Name** — Full name
   - **Email** — Email address (must be unique)
   - **Role** — Select from dropdown (all available roles)
   - **Password** — Initial password (minimum 4 characters)
   - **Active** — Toggle to activate/deactivate
3. Click **Save**
4. The user is created and can log in immediately

### 17.3 Editing a User

1. Click the **Edit** (pencil) icon on a user card
2. Modify any field:
   - **Name** — Update display name
   - **Email** — Change email address
   - **Role** — Change user role
   - **Password** — Enter new password to reset
   - **Active** — Activate or deactivate
3. Click **Save**
4. Changes take effect immediately on next login

### 17.4 Deleting a User

1. Click the **Delete** (trash) icon on a user card
2. A confirmation modal appears:
   - Shows the user name and email
   - Warning that this action cannot be undone
3. Click **Delete Permanently** to confirm
4. The user is removed from the system

**Note:** You cannot delete:
- Your own account
- The last SuperAdmin account

### 17.5 Activating/Deactivating

1. Click the **Power** icon on a user card
2. The user's active status is toggled
3. Deactivated users cannot log in
4. A toast notification confirms the change

---

## 18. System Configuration

![System Configuration](screenshots/18-settings.png)

**Available to:** IT Admin, SuperAdmin only

### Settings:

- **OCR Model** — Configure which Ollama model to use
- **SLA thresholds** — Set SLA time limits per stage
- **Approval thresholds** — Set amount-based approval tiers
- **Auto-approval** — Enable/disable automatic approval (currently disabled)
- **File watcher** — Configure incoming invoice folder
- **NextGen integration** — Configure NextGen API URL
- **Email notifications** — Configure SMTP settings
- **System health** — View API status, database connection, OCR engine status

---

## 19. Notifications

### 19.1 In-App Notifications

![Notification Bell](screenshots/19-notifications.png)

- **Bell icon** — Top-right of the sidebar, shows unread count badge
- **Click the bell** — Opens notification dropdown
- **Notification types:**
  - **Stage transitions** — Invoice moved to a new stage
  - **Exceptions** — New exception detected
  - **Approvals** — Approval requested or completed
  - **Uploads** — New invoice uploaded
  - **Payments** — Payment scheduled or completed
- **Mark as read** — Click a notification to mark it read
- **Mark all read** — Click "Mark all read" to clear all

### 19.2 Browser/System Notifications

- When you're **away from the tab** (switched tabs or minimized browser):
  - System-level notifications appear in your OS notification center
  - Clicking the notification brings you back to the application
  - Auto-close after 8 seconds
- When you're **on the tab**:
  - In-app toast notifications appear at the bottom-right
  - Auto-dismiss after 4 seconds

### 19.3 Enabling Browser Notifications

1. Log in to the system
2. Your browser will show a permission prompt: "Allow notifications?"
3. Click **Allow**
4. Notifications will now appear even when you're not looking at the app

---

## 20. Invoice Workflow & Status Flow

### 20.1 Status Flow Diagram

```
UPLOAD → PENDING_COORDINATOR → PENDING_PURCHASING_MGR → PENDING_MLO → PENDING_PLANNING_MGR → PENDING_SR_MANAGER → PENDING_MS_POLLY → PENDING_ACCOUNTING → POSTED_TO_QB → PAID
```

### 20.2 Status Definitions

| Status | Description | Who Acts |
|--------|-------------|----------|
| `UPLOADED` | Invoice uploaded, OCR extraction in progress | System |
| `PENDING_COORDINATOR` | Awaiting Purchasing Coordinator validation | Purchasing Coordinator |
| `PENDING_PURCHASING_MGR` | Awaiting Purchasing Manager approval | Purchasing Manager |
| `PENDING_MLO` | Awaiting MLO Account Holder approval | MLO Account Holder |
| `PENDING_PLANNING_MGR` | Awaiting Planning Manager approval | Planning Manager |
| `PENDING_SR_MANAGER` | Awaiting Sr Manager approval | Sr Manager Global Production |
| `PENDING_MS_POLLY` | Awaiting Ms Polly executive approval | Ms Polly |
| `PENDING_ACCOUNTING` | Awaiting Accounting review/posting | Accounting Associate/Supervisor |
| `POSTED_TO_QB` | Posted to QuickBooks | Accounting Associate |
| `PAID` | Payment confirmed | Accounting Associate |
| `REJECTED` | Invoice rejected | (Terminal) |
| `ON_HOLD` | Invoice placed on hold | Accounting Supervisor |
| `EXCEPTION` | Exception detected, awaiting resolution | Purchasing Coordinator |

### 20.3 Approval Tiers

The approval chain depends on the invoice amount:

| Amount Range | Required Approvals |
|--------------|-------------------|
| < $1,000 | Coordinator → Accounting |
| $1,000 - $10,000 | Coordinator → Purchasing Manager → Accounting |
| $10,000 - $50,000 | Coordinator → Purchasing Manager → MLO → Accounting |
| $50,000 - $100,000 | Coordinator → Purchasing Manager → MLO → Planning Mgr → Sr Manager → Accounting |
| > $100,000 | All approvers including Ms Polly |

**Note:** Auto-approval is currently **disabled** — all invoices go through the Purchasing Coordinator regardless of amount.

---

## 21. Troubleshooting

### 21.1 Cannot Log In

| Problem | Solution |
|---------|----------|
| "Invalid email or password" | Check your email and password. Default password is `madison88` for most accounts. JC SuperAdmin uses a secure password. |
| "Demo login is disabled" | This appears if demo login is turned off. Use the regular login form. |
| Login page doesn't load | Check your internet connection. The API server may be down — contact IT. |
| Forgot password | Contact the SuperAdmin (JC) or IT Admin to reset your password via User Management. |

### 21.2 Invoice Not Appearing

| Problem | Solution |
|---------|----------|
| Uploaded PDF not showing | Wait 30-60 seconds for OCR processing. Check the Invoice Repository. |
| Auto-imported invoice missing | Check the `incoming-invoices/` folder on the server. Check API logs. |
| Invoice stuck in "UPLOADED" | OCR may have failed. Try re-extraction from the invoice detail modal. |

### 21.3 Approval Issues

| Problem | Solution |
|---------|----------|
| Can't see approval button | Your role may not have approval permissions. Check with IT Admin. |
| Invoice stuck in approval | Contact the approver shown in the approval chain. Check SLA timer. |
| "Return to Previous Approver" not working | Ensure you're not a Purchasing Coordinator (this action is restricted for them). |

### 21.4 OCR Extraction Issues

| Problem | Solution |
|---------|----------|
| Low confidence score | Use the **Re-extract OCR** button in the invoice detail modal. |
| Wrong vendor detected | Edit the invoice and correct the vendor field manually. |
| Missing line items | Re-extract or manually add line items via Edit. |
| OCR engine not responding | Contact IT Admin to check Ollama service status on the VPS. |

### 21.5 Browser Notifications Not Working

| Problem | Solution |
|---------|----------|
| No notification prompt | Your browser may have blocked notifications. Check browser settings → Site permissions → Notifications. |
| Notifications don't appear | Ensure you allowed notifications when prompted. Try logging out and back in. |
| Notifications appear when on tab | This is expected — in-app toasts show when you're actively viewing the app. |

### 21.6 Contact Support

- **SuperAdmin:** JC (jc@madison88.com)
- **IT Support:** Contact IT Admin
- **System URL:** Check with your supervisor for the current deployment URL

---

## Appendix A: Default User Accounts

| Name | Email | Role | Default Password |
|------|-------|------|-----------------|
| JC | jc@madison88.com | SUPERADMIN | (secure password) |
| Maryan | maryan.untiveros@madison88.com | MLO_ACCOUNT_HOLDER | madison88 |
| Edwin | edwin.garcia@madison88.com | PLANNING_MANAGER | madison88 |
| Glecie | glecie.yumena@madison88.com | PLANNING_MANAGER | madison88 |
| Lindsey | lindsey.castro@madison88.com | SR_MANAGER_GLOBAL_PRODUCTION | madison88 |
| Polly | polly.madison@madison88.com | MS_POLLY | madison88 |
| Meann | meann@madison88.com | PURCHASING_MANAGER | madison88 |
| Maricar | maricar@madison88.com | PURCHASING_MANAGER | madison88 |
| Maricon | maricon@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Pamela | pamela@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Sarah | sarah@madison88.com | PURCHASING_COORDINATOR | madison88 |
| April | april@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Jasmine | jasmine@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Earl | earl@madison88.com | PURCHASING_COORDINATOR | madison88 |
| MJ Santiago | mjsantiago@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Joy | joy@madison88.com | PURCHASING_COORDINATOR | madison88 |
| Wyssa | wyssa@madison88.com | ACCOUNTING_ASSOCIATE | madison88 |
| Aldrin | Aldrin@madison88.com | ACCOUNTING_SUPERVISOR | madison88 |

**Note:** Passwords can be changed by the SuperAdmin via User Management.

---

## Appendix B: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` (on login form) | Submit login |
| `Esc` | Close modal/dialog |
| `Click` (notification) | Mark as read |
| `Click` (bell icon) | Open notifications dropdown |

---

## Appendix C: System Requirements

- **Browser:** Chrome, Edge, Firefox, or Safari (latest version)
- **JavaScript:** Must be enabled
- **Notifications:** Browser notification support (for system notifications)
- **PDF Viewer:** Built-in browser PDF viewer
- **Internet:** Stable connection to the API server

---

*This manual was generated for Madison 88 AP Invoice Automation System v2.0. For questions or updates, contact the SuperAdmin or IT Admin.*
