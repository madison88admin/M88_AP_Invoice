# Power Automate Setup Guide — Per-Coordinator Invoice Routing

## Problem
Not all invoices arrive at the shared `PURCHASINGTEAM@madison88.com` mailbox. Vendors sometimes email invoices directly to individual purchasing coordinators. We need Power Automate flows that:
1. Monitor each coordinator's personal inbox for invoice attachments
2. Forward attachments to the AP Invoice API for processing
3. Also handle files dropped to SharePoint and SFTP

## Backend Endpoints (Already Implemented)

The API has **3 webhook endpoints** ready to receive invoices from Power Automate:

### 1. `POST /api/email/invoice` (Recommended for Power Automate)
- **Auth**: API key via `x-api-key` header
- **Content**: Multipart form data with file + email metadata
- **Fields**:
  - `file` (required) — the invoice PDF/image attachment
  - `senderEmail` — vendor's email address
  - `senderName` — vendor's name
  - `subject` — email subject line
  - `receivedDate` — ISO timestamp
  - `internetMessageId` — Outlook message ID (for dedup)
  - `conversationId` — Outlook conversation ID (for dedup)
  - `mailbox` — which coordinator's mailbox this came from (e.g. "jc@madison88.com")
  - `importance` — email priority
  - `categories` — email categories/tags
- **Response**: `202 Accepted` with `{ jobId }` — poll `/api/invoices/jobs/:jobId` for status
- **Duplicate detection**: 3 levels (message ID, file hash, business key)

### 2. `POST /api/email-intake/powerautomate-webhook`
- **Auth**: API key via `x-api-key` header
- **Content**: JSON with base64-encoded attachment
- **Body**:
  ```json
  {
    "attachmentBase64": "<base64-encoded-file>",
    "fileName": "invoice.pdf",
    "contentType": "application/pdf",
    "emailSubject": "Invoice from Vendor",
    "fromAddress": "vendor@example.com",
    "receivedDateTime": "2026-01-15T10:00:00Z"
  }
  ```

### 3. `POST /api/email-intake/sharepoint-webhook`
- **Auth**: API key via `x-api-key` header
- **Content**: JSON with either base64 content or SharePoint URL
- **Body (with file content)**:
  ```json
  {
    "fileContentBase64": "<base64-encoded-file>",
    "fileName": "invoice.pdf",
    "contentType": "application/pdf",
    "emailSubject": "Invoice from Vendor",
    "fromAddress": "vendor@example.com",
    "receivedDateTime": "2026-01-15T10:00:00Z"
  }
  ```
- **Body (with SharePoint URL)**:
  ```json
  {
    "sharepointUrl": "https://madison88.sharepoint.com/sites/APInvoice/AP-Invoices/vendor/2026/01/invoice.pdf",
    "fileName": "invoice.pdf",
    "emailSubject": "Invoice from Vendor",
    "fromAddress": "vendor@example.com",
    "receivedDateTime": "2026-01-15T10:00:00Z"
  }
  ```

## Environment Variables Required

```env
# Webhook API key — set this to a strong random string
WEBHOOK_API_KEY=your-strong-api-key-here

# SharePoint (for file uploads from API)
SHAREPOINT_SITE_ID=your-site-id
SHAREPOINT_DRIVE_ID=your-drive-id
GRAPH_API_CLIENT_ID=your-client-id
GRAPH_API_CLIENT_SECRET=your-client-secret
GRAPH_API_TENANT_ID=your-tenant-id

# SFTP / File Watcher (for SFTP drops)
WATCHER_INCOMING_DIR=/incoming-invoices
WATCHER_PROCESSING_DIR=/incoming-invoices/processing
WATCHER_PROCESSED_DIR=/incoming-invoices/processed
WATCHER_DUPLICATES_DIR=/incoming-invoices/duplicates
WATCHER_MANUAL_REVIEW_DIR=/incoming-invoices/manual-review
WATCHER_FAILED_DIR=/incoming-invoices/failed
FILE_WATCHER_INTERVAL_SEC=30
```

---

## Power Automate Flow 1: Coordinator Inbox → API (Per-Coordinator)

**Purpose**: When a vendor emails an invoice to a coordinator's personal inbox, Power Automate forwards it to the API.

### Trigger
- **When a new email arrives** (Outlook trigger)
- **Folder**: Inbox
- **Has attachments**: Yes
- **Create one flow per coordinator** (or use a shared mailbox + condition on recipient)

### Steps

1. **Trigger: When a new email arrives (V3)**
   - Folder: `Inbox`
   - Only with attachments: Yes
   - Include attachments: Yes

2. **Condition: Has invoice attachment?**
   - Check attachment name ends with `.pdf`, `.jpg`, `.jpeg`, or `.png`
   - Or check attachment content type is `application/pdf`, `image/jpeg`, `image/png`

3. **For each attachment that matches:**

4. **Action: HTTP — Send to AP Invoice API**
   - Method: `POST`
   - URL: `https://your-api-domain.com/api/email/invoice`
   - Headers:
     ```
     x-api-key: <WEBHOOK_API_KEY>
     Content-Type: multipart/form-data
     ```
   - Body (multipart form data):
     - `file`: attachment content (binary)
     - `senderEmail`: `@{triggerOutputs()?['body/from']}`
     - `senderName`: `@{triggerOutputs()?['body/sender']}`
     - `subject`: `@{triggerOutputs()?['body/subject']}`
     - `receivedDate`: `@{triggerOutputs()?['body/receivedTime']}`
     - `internetMessageId`: `@{triggerOutputs()?['body/id']}`
     - `conversationId`: `@{triggerOutputs()?['body/conversationId']}`
     - `mailbox`: `jc@madison88.com` (the coordinator's email)
     - `importance`: `@{triggerOutputs()?['body/importance']}`

5. **Action: Move email to "Processed" folder** (optional)
   - Move the email to a subfolder like `Inbox/AP-Processed` after successful webhook call

6. **Action: Send notification** (optional)
   - Send an email/Teams notification to the coordinator: "Invoice received and processing started"

### Alternative: Single Flow with Shared Mailbox

Instead of one flow per coordinator, you can:
1. Create a **shared mailbox** (e.g. `ap-invoices@madison88.com`)
2. Add all coordinator personal emails as **forwarding rules** to this shared mailbox
3. Create **one Power Automate flow** on the shared mailbox
4. Use the `mailbox` field to track which coordinator the invoice was originally sent to

---

## Power Automate Flow 2: SharePoint Folder → API

**Purpose**: When a file is dropped into a SharePoint document library, process it through the API.

### Trigger
- **When a file is created in a folder** (SharePoint trigger)
- **Site**: `madison88.sharepoint.com/sites/APInvoice`
- **Library**: `AP-Invoices`
- **Folder**: `Incoming` (or root)

### Steps

1. **Trigger: When a file is created (properties only)**
   - Site: your SharePoint site
   - Library: your document library
   - Folder: `Incoming`

2. **Action: Get file content**
   - Site: same site
   - File Identifier: `@{triggerOutputs()?['body/Identifier']}`

3. **Action: HTTP — Send to SharePoint webhook**
   - Method: `POST`
   - URL: `https://your-api-domain.com/api/email-intake/sharepoint-webhook`
   - Headers:
     ```
     x-api-key: <WEBHOOK_API_KEY>
     Content-Type: application/json
     ```
   - Body:
     ```json
     {
       "fileContentBase64": "@{base64(outputs('Get_file_content')?['body'])}",
       "fileName": "@{triggerOutputs()?['body/Name']}",
       "contentType": "application/pdf",
       "emailSubject": "SharePoint upload",
       "fromAddress": "sharepoint@madison88.com",
       "receivedDateTime": "@{utcNow()}"
     }
     ```

4. **Action: Move file to "Processed" folder** (optional)
   - Move the file from `Incoming` to `Processed` after successful webhook call

---

## Power Automate Flow 3: SFTP Folder → API

**Purpose**: When a file is dropped into the SFTP incoming folder, process it.

**Note**: The backend already has a **file watcher service** that polls `/incoming-invoices` every 30 seconds. If your SFTP server drops files to this directory, no Power Automate flow is needed — the file watcher will pick them up automatically.

If your SFTP server is remote and not on the same machine as the API, use this flow:

### Trigger
- **When a file is added or modified** (FTP/SFTP trigger)

### Steps

1. **Trigger: When a file is added or modified (FTP/SFTP)**
   - Server: your SFTP server
   - Folder: `/incoming-invoices`
   - File type filter: `*.pdf,*.jpg,*.png`

2. **Action: Get file content**
   - File path: `@{triggerOutputs()?['body/FilePath']}`

3. **Action: HTTP — Send to Power Automate webhook**
   - Method: `POST`
   - URL: `https://your-api-domain.com/api/email-intake/powerautomate-webhook`
   - Headers:
     ```
     x-api-key: <WEBHOOK_API_KEY>
     Content-Type: application/json
     ```
   - Body:
     ```json
     {
       "attachmentBase64": "@{base64(outputs('Get_file_content')?['body'])}",
       "fileName": "@{triggerOutputs()?['body/FileName']}",
       "contentType": "application/pdf",
       "emailSubject": "SFTP upload",
       "fromAddress": "sftp@madison88.com",
       "receivedDateTime": "@{utcNow()}"
     }
     ```

---

## Coordinator Email Addresses

Create one Power Automate flow per coordinator. All purchasing coordinators:

| # | Coordinator | Email |
|---|------------|-------|
| 1 | Meann | meann@madison88.com |
| 2 | Maricar | maricar@madison88.com |
| 3 | Maricon | maricon@madison88.com |
| 4 | Pamela | pamela@madison88.com |
| 5 | Sarah | sarah@madison88.com |
| 6 | April | april@madison88.com |
| 7 | Jasmine | jasmine@madison88.com |
| 8 | Earl | earl@madison88.com |
| 9 | MJ | mjsantiago@madison88.com |
| 10 | Joy | joy@madison88.com |

For each coordinator, clone Flow 1 and change:
- The trigger mailbox (connect to that coordinator's Outlook account)
- The `mailbox` field value in the HTTP action (e.g. `meann@madison88.com`)

### Alternative: Single Flow with Shared Mailbox + Forwarding

Instead of 10 separate flows:
1. Create a **distribution group** or **shared mailbox** (e.g. `purchasing-all@madison88.com`)
2. Set up **inbox rules** on each coordinator's mailbox to forward invoice emails to the shared mailbox
3. Create **one Power Automate flow** on the shared mailbox
4. Use the `fromAddress` and original recipient to track which coordinator it was sent to

---

## API Key Setup

1. Set `WEBHOOK_API_KEY` in the API server's `.env` file:
   ```env
   WEBHOOK_API_KEY=ap-invoice-webhook-2026-secure-key
   ```

2. Use this same key in all Power Automate HTTP actions as the `x-api-key` header.

3. Alternatively, create an API key via the UI:
   - Go to Settings → API Keys
   - Create a new key with "Power Automate" label
   - Use that key in the `x-api-key` header

---

## Deduplication

The API has 3 levels of duplicate detection:
1. **Email message ID** — same Outlook message won't be processed twice
2. **File hash** — same file content won't be processed twice
3. **Business key** — same vendor + invoice number + amount + date won't be processed twice

This means if a vendor emails the same invoice to both `PURCHASINGTEAM@madison88.com` and `jc@madison88.com`, only the first one will be processed. The second will be flagged as duplicate.

---

## Testing

After setting up a flow, send a test email with a PDF attachment to the coordinator's inbox. Check:

1. **API logs**: Should show `POST /api/email/invoice - started`
2. **Job status**: Poll `GET /api/invoices/jobs/:jobId` to see processing status
3. **Dashboard**: The invoice should appear in the Dashboard with status `RECEIVED` or `EXCEPTION_FLAGGED`
4. **Audit log**: Should show `EMAIL_INVOICE_UPLOAD` action with `performed_by: powerautomate`

---

## Flow Diagram

```
Vendor Email
    │
    ├──► Coordinator Personal Inbox (e.g. jc@madison88.com)
    │         │
    │         └──► Power Automate Flow 1
    │                  │
    │                  └──► POST /api/email/invoice
    │                          │
    │                          ├──► OCR Processing
    │                          ├──► Vendor Matching
    │                          ├──► SharePoint Upload
    │                          ├──► Auto-Validation
    │                          └──► Invoice Created in Dashboard
    │
    ├──► PURCHASINGTEAM@madison88.com (shared mailbox)
    │         │
    │         └──► Email Poller (Graph API, every 5 min)
    │                  │
    │                  └──► Same processing pipeline
    │
    ├──► SharePoint Drop Folder
    │         │
    │         └──► Power Automate Flow 2
    │                  │
    │                  └──► POST /api/email-intake/sharepoint-webhook
    │
    └──► SFTP Server
              │
              ├──► File Watcher (local, every 30 sec) — if same server
              │
              └──► Power Automate Flow 3 — if remote SFTP
                       │
                       └──► POST /api/email-intake/powerautomate-webhook
```
