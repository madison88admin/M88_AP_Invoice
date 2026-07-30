# AP Invoice System — Testing Email Draft

> Copy everything below the line into a new Outlook email.
> Replace the `[bracketed]` placeholders before sending.

---

**To:** [Testing Distribution List / Team Members]
**Cc:** [Project Sponsors, IT Support]
**Subject:** UAT Testing — AP Invoice Processing Automation System (Read-Only)

Hi everyone,

We're rolling out the **AP Invoice Processing Automation System** for User Acceptance Testing (UAT). The test accounts have already been built in, so you can log in and start testing right away — no setup needed on your end.

### Purpose of this testing round

This is a **bug-hunting and validation round**, not a production rollout. We want to:

- Catch any bugs, UI issues, or workflow gaps before go-live.
- Validate that the AI-extracted invoice data matches the **actual invoice**.
- Confirm the upload, OCR preview, vendor matching, and dashboard flows work end-to-end.

### Important: AI accuracy is NOT 100%

The invoice fields are extracted by Azure Form Recognizer (OCR + AI). At this stage the AI is **not 100% accurate**, so every extracted invoice **must be manually checked and validated** against the source PDF before it is considered correct.

Please pay close attention to:

- Vendor name and vendor matching (auto-suggested vs. actual)
- Invoice number, invoice date, and due date
- Line items: quantity, unit price, line amount, material code
- Subtotal, tax, total, and currency
- Payment terms, bank/remittance details, and any custom fields
- MPO header / MPO line linkage (where applicable)

If a field is wrong, missing, or mis-extracted, please log it — that feedback is exactly what we need.

### How to test

1. Log in using the test credentials provided separately.
2. Upload a sample invoice PDF via the Upload screen (drag-and-drop supported).
3. Review the OCR result preview and **compare every field against the actual invoice**.
4. Edit any incorrect fields manually in the preview.
5. Confirm the vendor match (or assign manually if the auto-match is wrong).
6. Submit and verify the invoice appears correctly on the Dashboard.
7. Repeat with different invoice types: single-line, multi-line, suffix-style MPO, multi-currency, and an intentionally unmatched vendor case if possible.

### What to report

For each issue, please include:

- Invoice file name / invoice number
- Field name that is incorrect
- What the AI extracted vs. what the actual invoice shows
- Screenshot if possible
- Any error messages or UI glitches encountered

Please send all feedback to `[reply-to address]` or log it in `[issue tracker link / Teams channel]`.

### Reminders

- This is a **read-only** test environment — no data will be posted to QuickBooks or NextGen.
- Do not upload real production invoices containing live vendor banking details. Use the provided sample invoices or sanitized copies.
- All actions are audit-logged for this test cycle.

Thank you for helping us harden the system before production. Your validation work directly impacts go-live quality.

Best regards,

[Your Name]
[Title] — Madison 88 Business Solutions Asia Inc.
[Contact / Teams handle]
