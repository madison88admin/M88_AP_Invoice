## Trigger
**When a new email arrives in the Inbox (Office 365)**
- No filter conditions (process all emails with attachments)

## Flow Steps

### Step 1: Condition (Optional - Filter by Sender)
**Condition:** Check if email is from a known vendor
- **Condition:** From Address contains specific domain (e.g., @vendor.com)
- **If Yes:** Continue processing
- **If No:** Skip or process differently

### Step 2: Apply to Each (Process Attachments)
**Apply to each:** Attachments from the trigger email

#### Step 2a: Create File in SharePoint
**Action:** Create file in SharePoint
- **Site Address:** Your SharePoint site (e.g., Madison88 AP Invoice)
- **Folder Path:** `/AP-Invoices/Inbox` (or use dynamic folder based on date)
- **File Name:** `@{items('Apply_to_each')?['Name']}`
- **File Content:** `@{items('Apply_to_each')?['Content']}`

#### Step 2b: Call System Webhook
**Action:** HTTP
- **Method:** POST
- **URI:** `http://localhost:3001/api/email-intake/sharepoint-webhook`
- **Headers:**
  - Content-Type: application/json
- **Body:**
```json
{
  "sharepointUrl": "@{items('Create_file')?['Web Url']}",
  "fileName": "@{items('Apply_to_each')?['Name']}",
  "emailSubject": "@{triggerOutputs()?['body/subject']}",
  "fromAddress": "@{triggerOutputs()?['body/from/emailAddress/address']}",
  "receivedDateTime": "@{triggerOutputs()?['body/receivedDateTime']}"
}
```

### Step 3: Error Handling (Optional)
**Scope:** Try/Catch around the HTTP action
- **If HTTP fails:** Send notification email to IT team
- **Include error details and file information

## Production Deployment

**Replace localhost URL with production API URL:**
- Change `http://localhost:3001` to your actual API server URL
- Example: `https://api.madison88.com/api/email-intake/sharepoint-webhook`

**Add Authentication (Optional):**
- Add API key header to HTTP action
- Header name: `x-api-key`
- Header value: Your API key from environment variables

## Testing

**Test the flow:**
1. Send a test email with PDF invoice attachment
2. Verify file is created in SharePoint
3. Verify webhook is called successfully
4. Check system for new invoice record
5. Verify OCR processing and vendor matching

## Expected Behavior

**When flow runs:**
1. Email arrives in Outlook
2. Power Automate detects new email
3. Attachment is saved to SharePoint folder
4. System webhook is called with SharePoint URL
5. System downloads file from SharePoint
6. OCR processes the invoice
7. Vendor is matched
8. Invoice record is created
9. Auto-validation runs
10. Response returned to Power Automate

## Success Response
```json
{
  "success": true,
  "invoiceNumber": "INV-2024-001",
  "invoiceId": "uuid-here",
  "status": "RECEIVED",
  "exceptions": []
}
```

## Error Response
```json
{
  "success": false,
  "error": "Error message here"
}
```

## Notes
- Flow processes all attachments in each email
- SharePoint URL is extracted from the file creation step
- System handles OCR, vendor matching, and validation automatically
- No need to send base64 file content - system downloads from SharePoint
- Audit trail is created in the system for each processed invoice
