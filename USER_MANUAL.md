# AP Invoice System - User Manual

## Table of Contents
1. [System Overview](#system-overview)
2. [User Roles and Permissions](#user-roles-and-permissions)
3. [Invoice Workflow](#invoice-workflow)
4. [Getting Started](#getting-started)
5. [Dashboard Features](#dashboard-features)
6. [Uploading Invoices](#uploading-invoices)
7. [Editing Invoices](#editing-invoices)
8. [Validating Invoices](#validating-invoices)
9. [Approving/Rejecting Invoices](#approvingrejecting-invoices)
10. [Posting to Accounting](#posting-to-accounting)
11. [Handling Exceptions](#handling-exceptions)
12. [NextGen Validation](#nextgen-validation)
13. [Notifications](#notifications)
14. [Payment Scheduling](#payment-scheduling)
15. [Audit Logs](#audit-logs)
16. [Vendor Management](#vendor-management)
17. [Invoice Search and Filtering](#invoice-search-and-filtering)
18. [SLA Monitoring](#sla-monitoring)
19. [Invoice Corrections](#invoice-corrections)
20. [Parent/Child Invoices](#parentchild-invoices)
21. [QuickBooks Integration](#quickbooks-integration)
22. [System Configuration](#system-configuration)
23. [Troubleshooting](#troubleshooting)
24. [Best Practices](#best-practices)

---

## System Overview

The AP Invoice System automates the accounts payable invoice processing workflow, from invoice receipt through approval, validation, posting to QuickBooks, and payment scheduling.

**Key Features:**
- OCR-based invoice extraction
- Multi-level approval workflow
- NextGen PO validation
- QuickBooks integration
- In-app notifications
- Exception management
- Payment scheduling

---

## User Roles and Permissions

### Purchasing Coordinator
- Upload invoices
- Edit invoice details
- Request approvals
- Validate invoices
- Check NextGen changes

### Purchasing Manager
- All Coordinator permissions
- Approve invoices at Coordinator stage
- Review escalated items

### Accounting Associate
- Post invoices to accounting
- Release invoices from hold
- Schedule payments
- Check NextGen changes

### Accounting Supervisor
- All Accounting Associate permissions
- Bypass variance checks when posting
- Override pre-post validation blocks

### IT Admin
- Full system access
- User management
- System configuration

---

## Invoice Workflow

```
RECEIVED → VALIDATION_PENDING → PENDING_COORDINATOR → PENDING_MANAGER → 
PENDING_ACCOUNTING → APPROVED → POSTED_TO_QB → PAYMENT_SCHEDULED → PAID
```

**Alternative States:**
- `ON_HOLD` - Invoice held for batch threshold or validation issues
- `EXCEPTION_FLAGGED` - Invoice has unresolved exceptions
- `REJECTED` - Invoice rejected during approval

---

## Getting Started

1. **Login** - Access the system using your credentials
2. **Dashboard** - View your pending tasks and invoice statistics
3. **Navigation** - Use the sidebar to switch between:
   - Dashboard
   - Invoices
   - Approvals
   - Exceptions
   - Payments
   - Notifications

---

## Dashboard Features

### Overview
The Dashboard provides a centralized view of your invoice processing activities and key metrics.

### Key Components

**Pending Tasks Section**
- Shows invoices awaiting your action
- Displays invoice number, vendor, amount, and status
- Click to open invoice details

**Statistics Cards**
- Pending approvals count
- NextGen validation results
- Vendor mismatches
- Team performance metrics
- Approval rates
- Escalated items

**NextGen Validation Audit**
- Matched invoices count
- Warnings count
- Mismatches count
- Pending validations
- POs not found
- Skipped validations

**Invoice Filters**
- Date range (from/to)
- Status filter
- Vendor filter
- Category filter
- Search by invoice number

**Quick Actions**
- Upload Invoice button
- Navigate to Approvals
- Navigate to Exceptions
- Navigate to Payments

### Role-Specific Views
Each role sees different statistics and pending tasks based on their permissions and workflow stage.

---

## Uploading Invoices

### Manual Upload

1. Click **"Upload Invoice"** button on the Dashboard
2. Select invoice PDF file
3. System performs OCR extraction automatically
4. Review extracted data:
   - Invoice number
   - Vendor
   - Amount
   - Invoice date
   - Due date
   - PO/MPO number
   - Quantity shipped
5. Click **"Confirm OCR"** to save or **"Edit"** to correct extraction
6. Invoice moves to `VALIDATION_PENDING` status

### Email Integration (Coming Soon)
- Invoices can be received via email
- Automatic OCR processing
- System-generated invoice numbers

---

## Editing Invoices

### When to Edit
- OCR extraction errors
- Data entry mistakes
- Vendor information updates
- PO/MPO corrections

### Editing Process
1. Open invoice from Dashboard or Invoices page
2. Click **"Edit Invoice"** button
3. Modify editable fields:
   - Invoice number
   - Vendor
   - Amount
   - Invoice date
   - Due date
   - PO/MPO number
   - Quantity shipped
   - Brand code
   - Order type
   - Ship to / Sold to addresses
4. Click **"Save"** to update
5. System may re-validate based on changes

### Edit Restrictions
- Cannot edit invoices that are already approved
- Cannot edit invoices in payment processing
- Some fields may be locked based on invoice status
- Edits are logged in audit trail

---

## Validating Invoices

### Automatic Validation
After OCR confirmation, the system runs automatic validation checks:

- **Vendor validation** - Vendor exists in system
- **PO validation** - PO/MPO exists in NextGen
- **Amount validation** - Amount variance vs PO threshold
- **Late submission check** - Invoice date within SLA
- **Batch threshold check** - Vendor cumulative amount check

### Manual Validation
1. Open invoice from Dashboard
2. Click **"Run Validation"** or **"Re-Validate"**
3. System runs all validation rules
4. If validation passes → Invoice moves to approval stage
5. If validation fails → Invoice flagged with exceptions

### NextGen Validation Check
For invoices with MPO numbers:
1. Click **"Check NextGen Changes"**
2. System queries NextGen in real-time
3. Compares with stored data:
   - Amount
   - Vendor name
   - PO number
   - Quantity
4. **Critical changes** (amount, vendor, PO) create exceptions
5. **Informational changes** (quantity) show toast notification only

---

## Approving/Rejecting Invoices

### Approval Chain
1. **Purchasing Coordinator** - First approval
2. **Purchasing Manager** - Second approval (if required based on amount)
3. **Accounting Review** - Final accounting check

### Approving an Invoice
1. Open invoice from Dashboard or Approvals page
2. Click **"Approve"** button
3. Enter your signature name
4. Invoice moves to next stage in workflow

### Rejecting an Invoice
1. Open invoice from Dashboard or Approvals page
2. Click **"Reject"** button
3. Enter rejection reason
4. Invoice status changes to `REJECTED`
5. Notification sent to relevant users

### Approval Tiers
Based on invoice amount:
- **Tier 1** (< $5,000) - Coordinator approval only
- **Tier 2** ($5,000 - $25,000) - Coordinator + Manager
- **Tier 3** (> $25,000) - Coordinator + Manager + CFO

---

## Posting to Accounting

### Standard Posting
1. Invoice must be in `APPROVED` or `PENDING_ACCOUNTING` status
2. All signatures must be complete
3. No unresolved exceptions
4. Click **"Post to Accounting"**
5. System runs pre-post checks:
   - Amount variance vs PO (5% threshold)
   - PO existence in NextGen
6. If checks pass → Invoice posted to QuickBooks
7. Status changes to `POSTED_TO_QB`

### Variance Check Bypass (Accounting Supervisor Only)
If invoice has high variance (>5%) but is legitimate:
1. Check **"Bypass variance check (override PO amount mismatch)"** checkbox
2. Click **"Post to Accounting"**
3. Variance check is skipped
4. Bypass is logged in audit trail
5. Invoice posted to QuickBooks

### Release from Hold
If invoice is `ON_HOLD` due to validation issues:
1. Resolve the underlying exceptions
2. Click **"Release from Hold"**
3. Invoice returns to `PENDING_ACCOUNTING` status
4. Can be posted again

---

## Handling Exceptions

### Exception Types
- **LATE_SUBMISSION** - Invoice submitted outside SLA
- **AMOUNT_MISMATCH** - Invoice amount differs from PO
- **PO_NOT_FOUND** - PO not found in NextGen
- **VENDOR_NOT_FOUND** - Vendor not in system
- **BATCH_THRESHOLD_NOT_MET** - Vendor cumulative below threshold

### Viewing Exceptions
1. Go to **Exceptions** page
2. Filter by invoice, type, or status
3. Click exception to view details

### Resolving Exceptions
1. Open the exception
2. Review the issue details
3. Take corrective action:
   - Edit invoice data
   - Update NextGen data
   - Contact vendor
   - Override with supervisor approval
4. Mark exception as **RESOLVED**
5. Invoice can proceed in workflow

---

## NextGen Validation

### Real-time Validation
The system validates invoice data against NextGen ERP:

**Checks performed:**
- PO/MPO existence
- Vendor name match
- Amount comparison
- Quantity comparison
- Line item details

### NextGen Validation Badge
In the invoice table, each invoice shows a NextGen validation status:
- **Green (Auto-Approved)** - Data matches NextGen
- **Yellow (Review Required)** - Minor discrepancies
- **Red (Failed)** - Critical mismatches

### Checking for NextGen Changes
1. Open invoice with MPO number
2. Click **"Check NextGen Changes"**
3. System queries NextGen in real-time
4. Shows changes detected:
   - **Critical** (amount, vendor, PO) - Creates exception
   - **Informational** (quantity) - Toast notification only

---

## Notifications

### In-App Notifications
Real-time notifications for:
- New invoice assignments
- Approval requests
- Invoice rejections
- Stage transitions
- Exception flags
- Payment completions

### Notification Panel
1. Click bell icon in top right
2. View unread notifications
3. Click notification to navigate to related invoice
4. Mark as read by clicking

### Notification Types
- **Approval Required** - Your approval is needed
- **Invoice Rejected** - Invoice you submitted was rejected
- **Exception Flagged** - Invoice has exceptions
- **Posted to QB** - Invoice posted to QuickBooks
- **Payment Scheduled** - Payment date set
- **Payment Completed** - Payment processed

---

## Payment Scheduling

### Scheduling a Payment
1. Invoice must be in `POSTED_TO_QB` status
2. Open invoice details
3. Click **"Schedule Payment"**
4. Select payment date
5. Click **"Confirm"**
6. Invoice status changes to `PAYMENT_SCHEDULED`

### Processing Payments
1. Go to **Payments** page
2. View scheduled payments
3. Click **"Process"** on payment
4. Payment is sent to bank
5. Invoice status changes to `PAID`

---

## Audit Logs

### Viewing Audit Logs
1. Open invoice details
2. Click **"Audit Log"** tab
3. View complete history:
   - Creation
   - Validations
   - Approvals
   - Rejections
   - Posting
   - Exceptions
   - Changes

### Audit Log Entries
Each entry shows:
- Action performed
- User who performed it
- Timestamp
- Notes/details

### Audit Actions Tracked
- **INVOICE_CREATED** - Invoice uploaded
- **INVOICE_VALIDATED** - Validation completed
- **INVOICE_VALIDATION_FAILED** - Validation failed
- **APPROVAL_REQUESTED** - Approval workflow started
- **INVOICE_APPROVED** - Invoice approved
- **INVOICE_REJECTED** - Invoice rejected
- **INVOICE_POSTED** - Invoice posted to accounting
- **PRE_POST_CHECK_FAILED** - Pre-post validation failed
- **PRE_POST_WARNINGS** - Pre-post warnings (non-blocking)
- **RELEASED_FROM_HOLD** - Invoice released from hold
- **EXCEPTION_CREATED** - Exception flagged
- **EXCEPTION_RESOLVED** - Exception resolved
- **PAYMENT_SCHEDULED** - Payment date set
- **PAYMENT_PROCESSED** - Payment completed
- **NEXTGEN_CHECK** - NextGen validation check performed

---

## Vendor Management

### Viewing Vendors
1. Navigate to Vendors section (if available)
2. View all vendors in system
3. Check vendor details:
   - Name
   - Bank information
   - Invoice template type
   - Supplier location

### Adding New Vendors
Contact IT Admin to add new vendors to the system.

### Vendor Bank Verification
- Vendors must have verified bank accounts
- Bank verification status shown in vendor profile
- Unverified banks may block invoice processing

---

## Invoice Search and Filtering

### Search Options
- **Invoice Number** - Exact match search
- **Vendor Name** - Filter by vendor
- **Date Range** - Filter by invoice date
- **Status** - Filter by invoice status
- **Category** - Filter by invoice category (TRIMS, FABRIC, etc.)

### Advanced Filters
- **PO/MPO Number** - Filter by purchase order
- **Amount Range** - Filter by amount
- **Approval Stage** - Filter by workflow stage
- **Exception Status** - Filter by exception presence

### Sorting
- Sort by date (newest/oldest)
- Sort by amount (highest/lowest)
- Sort by status
- Sort by vendor

---

## SLA Monitoring

### SLA Thresholds
The system monitors Service Level Agreement (SLA) compliance:

**Late Submission Warning:** 7 days after invoice date
**Late Submission Error:** 14 days after invoice date

### SLA Tracking
- SLA status shown on invoice cards
- Color-coded indicators:
  - Green - Within SLA
  - Yellow - Approaching SLA limit
  - Red - SLA exceeded

### SLA Alerts
- Automatic exceptions for late submissions
- Notifications for invoices approaching SLA limits
- Reporting on SLA compliance rates

### Stage SLA Tracking
Each workflow stage tracks elapsed time:
- Validation stage
- Approval stages
- Accounting review
- Payment processing

---

## Invoice Corrections

### Correction Types
- **OCR Corrections** - Fix extraction errors during upload
- **Data Corrections** - Fix data entry errors
- **Similar Invoice Corrections** - Apply corrections from similar invoices

### OCR Corrections
1. During upload, review extracted data
2. Click **"Edit"** to correct extraction
3. Modify fields as needed
4. Click **"Confirm OCR"** to save
5. System learns from corrections for future invoices

### Similar Invoice Corrections
1. When editing invoice, click **"Find Similar"**
2. System finds invoices with similar patterns
3. View corrections applied to similar invoices
4. Apply relevant corrections to current invoice

### Correction Tracking
- All corrections logged in audit trail
- System improves OCR accuracy over time
- Correction patterns used for training

---

## Parent/Child Invoices

### Parent Invoices (PI)
- Main invoice for a shipment
- Can have multiple child invoices
- Used for partial shipments or split billing

### Child Invoices (CI)
- Linked to a parent invoice
- Represent portions of a larger invoice
- Must reference parent invoice

### Creating Child Invoices
1. Create or open parent invoice
2. Link child invoices during creation
3. System maintains parent-child relationship
4. Parent invoice shows summary of all children

### Parent/Child Workflow
- Parent invoice approval may require child approval
- Payments can be scheduled for parent or individual children
- Exceptions on child invoices may affect parent

---

## QuickBooks Integration

### QuickBooks Posting
When invoice is posted to accounting:
1. System creates QuickBooks invoice record
2. Maps invoice data to QB fields:
   - Invoice number
   - Vendor
   - Amount
   - GL account
   - Memo/notes
   - Class/location
   - Currency
3. Returns QB Invoice ID
4. Logs posting in audit trail

### GL Account Mapping
- System automatically determines GL account based on:
  - Vendor category
  - Invoice type
  - Business rules
- GL account shown in invoice details

### QuickBooks Status
- **Not Posted** - Invoice not yet sent to QB
- **Posted** - Successfully posted to QB
- **Failed** - Posting failed (check exceptions)

### QuickBooks Error Handling
- Posting failures create exceptions
- Retry posting after resolving issues
- Error details logged in audit trail

---

## System Configuration

### Environment Variables
System configuration managed via environment variables:

**Database:**
- DATABASE_URL - PostgreSQL connection string

**NextGen:**
- NEXTGEN_API_URL - NextGen API endpoint
- NEXTGEN_USERNAME - NextGen username
- NEXTGEN_PASSWORD - NextGen password

**QuickBooks:**
- QB_CLIENT_ID - QuickBooks OAuth client ID
- QB_CLIENT_SECRET - QuickBooks OAuth secret
- QB_REDIRECT_URI - QuickBooks OAuth redirect
- QB_ENVIRONMENT - sandbox or production

**OCR Services:**
- GEMINI_API_KEY - Google Gemini API key
- GROQ_API_KEY - Groq API key
- OLLAMA_URL - Ollama service URL

### Approval Thresholds
Configured in system code:
- Tier 1: < $5,000
- Tier 2: $5,000 - $25,000
- Tier 3: > $25,000

### Variance Thresholds
- Variance Warning: 2%
- Variance Block: 5%

### Batch Threshold
- Vendor cumulative threshold: $100

---

## Troubleshooting

### Invoice Stuck in Validation
**Symptoms:** Invoice remains in VALIDATION_PENDING or EXCEPTION_FLAGGED status
**Causes:**
- Unresolved exceptions
- Vendor not found in system
- PO/MPO not found in NextGen
- Batch threshold not met
**Solutions:**
- Check Exceptions page for unresolved issues
- Verify vendor exists in Vendors section
- Ensure PO/MPO is valid in NextGen
- Try re-validating after corrections
- Contact IT if system error

### Cannot Post to Accounting
**Symptoms:** "Post to Accounting" button disabled or posting fails
**Causes:**
- Missing signatures
- Unresolved exceptions
- Pre-post check failures (variance, PO not found)
- Invoice not in correct status
**Solutions:**
- Verify all signatures are complete
- Check for unresolved exceptions
- Review pre-post check results in audit log
- If variance exceeds threshold, use bypass (Supervisor only)
- Ensure invoice is in APPROVED or PENDING_ACCOUNTING status

### NextGen Validation Failed
**Symptoms:** PO_NOT_FOUND exception or validation badge shows red
**Causes:**
- Incorrect MPO number
- NextGen system down
- Network connectivity issues
- PO deleted or modified in NextGen
**Solutions:**
- Verify MPO number is correct
- Check NextGen system is accessible
- Try "Check NextGen Changes" to refresh data
- Contact IT if NextGen is down
- Update MPO number if incorrect

### Duplicate Exceptions
**Symptoms:** Multiple identical exceptions for same invoice
**Causes:**
- Pre-post check ran multiple times before fix
- Validation triggered repeatedly
**Solutions:**
- Resolve duplicate exceptions manually
- System now prevents creating duplicates
- Keep one exception, resolve others as duplicates
- Contact IT if duplicates continue appearing

### OCR Extraction Errors
**Symptoms:** Extracted data is incorrect or missing
**Causes:**
- Poor PDF quality
- Non-standard invoice format
- Scanned invoice (not native PDF)
- OCR service issues
**Solutions:**
- Use "Edit" to correct extraction during upload
- Provide high-quality PDFs
- Use native PDFs when possible
- System learns from corrections over time
- Contact IT if OCR service is down

### Approval Workflow Stuck
**Symptoms:** Invoice not moving to next approval stage
**Causes:**
- Approver not assigned
- Approver on leave
- Approval threshold not met
**Solutions:**
- Check approval chain in audit log
- Contact approver directly
- Request approval reassignment
- Contact IT to check approval rules

### Payment Scheduling Failed
**Symptoms:** Cannot schedule payment for posted invoice
**Causes:**
- Invoice not in POSTED_TO_QB status
- Bank information missing
- Vendor bank not verified
**Solutions:**
- Ensure invoice is posted to QuickBooks
- Verify vendor bank information is complete
- Check vendor bank verification status
- Contact IT for bank verification

### Notifications Not Showing
**Symptoms:** Not receiving expected notifications
**Causes:**
- Browser notifications blocked
- Notification panel not refreshed
- User role not in notification target
**Solutions:**
- Enable browser notifications
- Refresh the page
- Check notification panel manually
- Verify user role has notification permissions

### Slow Performance
**Symptoms:** System loading slowly or timeouts
**Causes:**
- Large number of invoices
- Network issues
- Database performance
**Solutions:**
- Use filters to reduce data load
- Check network connection
- Contact IT for database optimization
- Try during off-peak hours

### Login Issues
**Symptoms:** Cannot log into system
**Causes:**
- Incorrect credentials
- Account locked
- Session expired
**Solutions:**
- Verify username and password
- Contact IT for account unlock
- Clear browser cache and cookies
- Try different browser

### QuickBooks Posting Failed
**Symptoms:** Invoice not posting to QuickBooks
**Causes:**
- QuickBooks API down
- Authentication issues
- Invalid data mapping
**Solutions:**
- Check QuickBooks connection status
- Verify QB credentials are valid
- Review invoice data for errors
- Contact IT for QuickBooks support

---

## Best Practices

### For Purchasing Coordinators
1. **Review OCR extraction** - Always verify extracted data before confirming
2. **Check NextGen early** - Validate PO/MPO before requesting approvals
3. **Use corrections wisely** - Provide accurate corrections to improve OCR
4. **Monitor SLA** - Submit invoices within 7 days to avoid SLA issues
5. **Communicate with vendors** - Clarify discrepancies early

### For Purchasing Managers
1. **Review escalated items** - Address exceptions promptly
2. **Verify approvals** - Ensure proper approval chain is followed
3. **Monitor team performance** - Track approval rates and SLA compliance
4. **Document overrides** - Keep notes for any approval exceptions

### For Accounting Associates
1. **Pre-post checks** - Review variance warnings before posting
2. **Release holds carefully** - Ensure underlying issues are resolved
3. **Schedule payments timely** - Meet payment due dates
4. **Check NextGen changes** - Validate data before posting

### For Accounting Supervisors
1. **Use variance bypass carefully** - Only for legitimate cases
2. **Audit bypass usage** - Monitor bypass frequency and reasons
3. **Review exceptions** - Ensure proper exception resolution
4. **Monitor payment processing** - Ensure timely payments

### For All Users
1. **Monitor notifications** - Stay on top of approval requests
2. **Keep audit trail clean** - Document reasons for overrides
3. **Use search filters** - Find invoices efficiently
4. **Report issues promptly** - Contact IT for system problems
5. **Follow security practices** - Log out when done, protect credentials

---

## Security Guidelines

### Password Security
- Use strong passwords (minimum 8 characters, mix of letters, numbers, symbols)
- Change passwords regularly
- Do not share credentials
- Report suspicious activity immediately

### Data Protection
- Do not download invoice PDFs unnecessarily
- Use secure network connections
- Lock screen when away from desk
- Report data breaches immediately

### Access Control
- Only access invoices relevant to your role
- Do not attempt to bypass permission restrictions
- Log out after each session
- Report unauthorized access attempts

---

## Glossary

**OCR** - Optical Character Recognition, technology to extract text from PDFs

**PO** - Purchase Order, document sent to vendor to request goods/services

**MPO** - Master Purchase Order, main purchase order in NextGen system

**NextGen** - ERP system for purchase order and vendor management

**QuickBooks** - Accounting software for financial management

**SLA** - Service Level Agreement, time limits for invoice processing

**GL Account** - General Ledger account, accounting code for expense categorization

**Variance** - Difference between invoice amount and PO amount

**Exception** - Flagged issue that prevents invoice from proceeding in workflow

**Batch Threshold** - Minimum cumulative amount for vendor before processing

**Parent Invoice** - Main invoice that can have linked child invoices

**Child Invoice** - Invoice linked to a parent invoice for partial shipments

**AST** - Automated System Testing, validation mode for testing

**Incoterm** - International Commercial Terms, shipping and delivery terms

---

## Support and Contact

### System Support
For technical issues, bugs, or system errors:
- Contact IT Admin
- Email: support@company.com
- Phone: [Internal IT extension]

### Business Support
For workflow questions, approval issues, or process clarification:
- Contact your supervisor
- Contact Accounts Payable team
- Email: ap-support@company.com

### Emergency Contacts
For urgent issues affecting payment processing:
- Accounting Supervisor
- CFO Office
- IT Emergency Line

---

## Version History

- **v1.0** - Initial release
- **v1.1** - Added NextGen real-time validation
- **v1.2** - Added variance check bypass for Accounting Supervisor
- **v1.3** - Added in-app notifications
- **v1.4** - Improved batch threshold logic
- **v1.5** - Added duplicate exception prevention
- **v1.6** - Expanded NextGen validation to include quantity and amount comparisons
- **v1.7** - Separated critical vs informational NextGen changes

---

## Appendix

### Invoice Status Reference
- **RECEIVED** - Invoice uploaded, awaiting processing
- **VALIDATION_PENDING** - Awaiting validation checks
- **PENDING_COORDINATOR** - Awaiting Coordinator approval
- **PENDING_MANAGER** - Awaiting Manager approval
- **PENDING_ACCOUNTING** - Awaiting accounting review
- **APPROVED** - All approvals complete, ready for posting
- **ON_HOLD** - Held for batch threshold or validation issues
- **EXCEPTION_FLAGGED** - Has unresolved exceptions
- **REJECTED** - Rejected during approval workflow
- **POSTED_TO_QB** - Posted to QuickBooks
- **PAYMENT_SCHEDULED** - Payment date set
- **PAID** - Payment processed and complete

### Exception Reference
- **LATE_SUBMISSION** - Invoice submitted outside SLA
- **AMOUNT_MISMATCH** - Invoice amount differs from PO
- **PO_NOT_FOUND** - PO not found in NextGen
- **VENDOR_NOT_FOUND** - Vendor not in system
- **BATCH_THRESHOLD_NOT_MET** - Vendor cumulative below threshold
- **SIGNATURE_MISSING** - Required signature not complete
- **GL_ACCOUNT_MISSING** - GL account not determined

### Approval Tier Reference
- **Tier 1** - < $5,000: Coordinator approval only
- **Tier 2** - $5,000 - $25,000: Coordinator + Manager
- **Tier 3** - > $25,000: Coordinator + Manager + CFO

### Invoice Categories
- **TRIMS** - Trims and accessories
- **FABRIC** - Fabric materials
- **PACKAGING** - Packaging materials
- **SERVICES** - Service invoices
- **OTHER** - Other categories

### Document Revision
This manual is maintained by the IT team and updated as new features are added. Last updated: July 2026
