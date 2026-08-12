# AP Invoice — Requirements Review Checklist

**Date discussed:** 2026-08-11  ·  **Status:** For stakeholder review — tick each item to confirm.

> All Payment Batch items below are scoped **within the Payment Batches module only** (scheduled-payments list + batch screens, `PaymentBatchManager`). Nothing moves to other screens.

---

## A. Payment Batches — Filters & Columns

- [x] **1. Filters:** date, invoice number, vendor name, memo details + brand, manager approval date, due date, split/account (SAMPLE / YARNS / TRIMS), aging, open balance ✅ *(built 2026-08-11)*
- [x] **2. Due-month cut-off:** filter invoices whose due date falls in a specific month — **and** vendor-name filter works inside this due-month view ✅ *(built; a specific day within the month is available via the Due From/To date filters)*
- [x] **3. Filtered total:** when filtering (e.g. by vendor), the shown total = only the filtered rows (per currency) ✅ *(built — `totals` computed on the filtered result set)*
- [x] **4. Table columns:** invoice date · invoice # · vendor · memo details + brand · manager approval date · due date · split/account · aging · open balance · amount · payment date · status ✅ *(built)*

## B. Payment Statuses (shown in the Status column)

- [x] **5.** `SCHEDULED` — default; payment date **auto-set from the invoice's due date** ("possible payment date", Associate does not type the date) ✅ *(built 2026-08-11 — `schedulePayment` derives `payment_date` from `invoice.due_date`; **auto-scheduled on posting** — posting an invoice to QB now creates the SCHEDULED payment immediately and the manual Schedule Payment modal was removed from the Dashboard; the batch list shows past-due payments too, since payment_date = due_date)*
- [x] **6.** `HELD_BELOW_100` — sub-$100 invoices held; they **appear when they fall within the cut-off set by the Accounting Associate (on or before the due date)**; **system notifies Purchasing**; the invoice proceeds only after the **Purchasing Coordinator approves** that it can proceed for payment or be consolidated *(release decision confirmed: tied to the Associate's cut-off, on or before due date)* ✅ *(built 2026-08-11 — `schedulePayment` marks sub-$100 payments `HELD_BELOW_100` on posting and notifies `PURCHASING_COORDINATOR`; the default schedule view shows held payments only when their due date falls within the applied due-month/range cut-off; the explicit `HELD_BELOW_100` filter is the Purchasing review queue with a banner + per-row **Approve Release** (`POST /payments/:id/approve-held`, Purchasing Coordinator-only) → `SCHEDULED` and batchable, Associate notified)* — **bug fixed 2026-08-12**: the due-month / due-range cut-off filter was 500-ing since item 8 shipped (the held-payments `OR` was nested inside `status: { OR: [...] }`, an invalid Prisma shape caught by the live QA run); the `OR` now lives at the top level of `where`, and a regression unit test pins it. — **consolidated 2026-08-12**: the legacy posting-time vendor-cumulative auto-hold (`ACCOUNTING_AUTO_HOLD` / `BATCH_THRESHOLD_NOT_MET` in `postInvoice`) was **removed** — the business confirmed scheduling-time `HELD_BELOW_100` is the correct mechanism, so sub-$100 invoices now always post and reach the hold at scheduling. The manual hold endpoint stays as an operator tool.
- [x] **7.** `FOR_PAYMENT` — Associate adds remarks and marks the invoice "for payment" → goes to the Supervisor; the Supervisor **approves ("okay for payment") or rejects with a reason**; after approval, only the payment process follows (remarks loop: remarks → supervisor) ✅ *(built 2026-08-11 — Associate marks FOR_PAYMENT; Supervisor approves → `APPROVED_FOR_PAYMENT` (then batchable), or rejects with a reason → back to `SCHEDULED`; reason visible in the Remarks column; supervisor review-queue banner with count)*
- [x] **8.** `ENDORSED` — bill stub **endorsed by the Accounting Associate** to the Supervisor — **tagging only** that the invoice is in payment process (NOT paid) ✅ *(built 2026-08-11 — `POST /batches/:id/payments/:paymentId/endorse`; bill stub header date/type/reference/original amount/balance/discount/payment + optional file upload; upsert so a stub can be edited; only for REVIEWED/EXPORTED_TO_BANK batches)*
- [x] **9.** `PAID` — tagged when the **payment confirmation** arrives; the system matches the invoices via the exported Excel file (or the bill stub). **No CC (VP) check — the Supervisor's approval is the last process** ✅ *(built 2026-08-11 — `POST /batches/:id/match-confirmation` matches ENDORSED payments by **reference** with **amount as tiebreak** (two vendors with the same processed amount are disambiguated by amount, or by explicit selection from the exported Excel); batch auto-marks PROCESSED when all payments are PAID)*

## C. Payment Batches — Workflow

- [x] **10. Remarks:** only the Accounting Associate can add/edit remarks (per invoice) ✅ *(built 2026-08-11 — `POST /payments/:id/remarks`, Associate-only route; remarks column + edit modal)*
- [x] **11. Supervisor:** view-only + can add remarks + **bulk approve** (approve all at once) — **approval is FINAL (no CC/VP step)**; when returned, the supervisor's **final remarks** are what the Associate sees ✅ *(built 2026-08-11 — per-payment Approve/Reject + **bulk approve** via `POST /payments/bulk-approve-for-payment` (Approve All in the banner + review-queue bar, optional note recorded per invoice); reject now uses a **Final Remarks (required)** modal — the remarks are shown to the Associate in the Remarks column on return)*
- [x] **12. Bank charge:** NOT applied at OCR; applied during batch payment to **ONE invoice only**, **one per supplier/vendor** — system blocks a duplicate bank charge for the same vendor ✅ *(built 2026-08-11 — `POST/DELETE /batches/:id/bank-charge` (Associate-only, DRAFT/RETURNED batches only); one charge per batch (batches are single-vendor → one per vendor per batch), duplicates blocked until removed; `batch.total_amount` recomputed to include the charge; shown in batch details, per-vendor Excel (Bank Charge column + TOTAL), and NextGen payment file)*
- [x] **13. Pay Bills / Bill Stub:** batch amount = what gets paid (like QB Pay Bills). Bill stub header: **date, type, reference, original amount, balance, discount, payment**. Endorsed by the **Accounting Associate** to the Supervisor (tagging the invoice as in payment process), uploaded to the system — payment is NOT automatically PAID ✅ *(built 2026-08-11 — new `BillStub` table; endorse modal in batch details; stub shown in the payments table with file link; supersedes the old "Execute Payments → auto-PAID" button)*
- [x] **14. Payment confirmation match:** when the payment confirmation arrives, the system matches the invoices (exported **Excel file** checked by the system, or the bill stub) by **reference number** (amount as secondary — disambiguates two vendors with the same processed amount) → tagged **PAID** ✅ *(built 2026-08-11 — Match Payment Confirmation modal: reference + optional amount tiebreak, or explicit payment selection; PAID only after this match)*

## D. Purchasing — SLA ⛔ DISREGARDED (removed from scope)

- [x] ~~**15.** SLA starts on arrival (7 days)~~ — **disregarded by business (2026-08-11)** — no SLA change for now
- [x] ~~**16.** Manager has a different SLA~~ — **disregarded**

## E. QuickBooks

- [x] **17.** Real QuickBooks export file (Excel) for posted invoices (replaces the simulated "sync" — nothing talks to QB live) ✅ *(built 2026-08-11 — `GET /api/qb/export` downloads `qb-bills-<date>.xlsx` with QB Bills / Bill Lines / Summary sheets: vendor, beneficiary, account #, invoice/due dates, amount, currency, memo, **GL account**, **GL class**, MPO, brand, entity, status; Bill Lines sheet groups lines by MPO like posting. Posting no longer fabricates a QB ID — audit notes "ready for manual import via the QB Bills export". Fake `qbSyncService` deleted. Button: Export QB Bills on the Scheduled Payments header)*
- [x] **18.** **Reconciliation Excel for payment batches** — downloadable Excel report of payments/batches (batch number, invoice #, vendor, amount, **bank charge**, total incl. charge, currency, payment date, payment source, reference, paid date, status) for reconciling against the bank statement and payment confirmations — **bank-charge rows are included in the recon totals** (Payments sheet has a Bank Charge column + per-currency TOTAL rows summing payments + charges; dedicated **Bank Charges** sheet; **Batches** sheet shows per-batch Payments Total / Bank Charge / Grand Total incl. charge). Also serves as the Excel file the system checks to tag invoices PAID on payment-confirmation match (item 14). Existing exports alongside: per-vendor batch Excel + CitiBusiness CSV ✅ *(built 2026-08-11 — `GET /api/payment-batches/reconciliation`, Export Reconciliation button on the Batches tab; optional status + batch created-at date-range filters)*

---

## F. Decisions — status

- [x] **D2. Bank-charge scope:** **per batch** — one bank charge per vendor per batch ✅ *(confirmed 2026-08-11)*
- [x] **D3. Sub-$100 release:** released when the invoice **falls within the cut-off set by the Accounting Associate** (on or before the due date); below-$100 invoices appear in that cut-off view ✅ *(confirmed 2026-08-11)*
- [x] ~~**D4. SLA days**~~ — **disregarded** *(removed from scope)*

---

## Suggested build order (after decisions)

1. ~~Filters + columns + due-month cut-off + filtered totals~~ ✅ **DONE (2026-08-11)**  →  2. ~~Auto payment date from due date~~ ✅ **DONE (2026-08-11)**  →  3. ~~Remarks + "For Payment" status + supervisor approve/reject~~ ✅ **DONE (2026-08-11)**  →  4. ~~Supervisor bulk approve (final) + final remarks~~ ✅ **DONE (2026-08-11)**  →  5. ~~Bank charge (1 per vendor per batch)~~ ✅ **DONE (2026-08-11)**  →  6. ~~QB export file~~ ✅ **DONE (2026-08-11)**  →  7. ~~Bill Stub + payment-confirmation match (no CC)~~ ✅ **DONE (2026-08-11)**  →  8. ~~Sub-$100 hold (released in Associate's cut-off, w/ Purchasing Coordinator approval)~~ ✅ **DONE (2026-08-11)** — ~~SLA~~ dropped
