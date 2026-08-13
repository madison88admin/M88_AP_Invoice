# Payment Batch & QuickBooks — Gap Analysis & Recommendations

**Scope:** Accounting payment-batch workflow + QuickBooks posting + Purchasing SLA start.
**Based on:** current code (`paymentBatchService.ts`, `paymentBatch.ts` controller/routes, `PaymentBatchManager.tsx`, `postingService.ts`, `qbSyncService.ts`, `validation-rules.ts`) — verified against the live system on 2026-08-11.

> **Scope confirmation (business, 2026-08-11):** *ALL* of the batch-payment requirements below — filters, columns, statuses (HELD_BELOW_100 / FOR_PAYMENT / ENDORSED / PAID), remarks, bank charge, bill stub, CC approval — apply **within the Payment Batches module only** (`PaymentBatchManager` + payment-batch API). Everything is tracked on `Payment` records and the batch screens; no other screen is affected.

---

## 0. The single most important finding

**QuickBooks is not actually integrated — it is simulated.** `qbSyncService.ts` generates fake invoice IDs (`QB-RETRY-…`, `QB-FORCE-…`), the `qb_invoice_id` column does not exist in the Prisma schema, and `processPayment` uses `simulatePaymentProcessing()` returning a fake `PAY-<timestamp>` reference. Nothing ever talks to QuickBooks. The same applies to payments: they are marked PAID by hand after the manual CitiBusiness upload — which is fine and by design — but the "POSTED_TO_QB" label is misleading.

Recommendation before anything else: **decide what "posting to QuickBooks" means operationally** (see §4).

---

## 1. Batch payment — requirement by requirement

| # | Your requirement (as understood) | Current state | Gap | Recommendation |
|---|---|---|---|---|
| 1a | Filter by **date** | `dateFrom`/`dateTo` filter on **payment_date** only | No filter on invoice date / due date / approval date | Add per-field date filters: invoice date, due date, manager-approval date (derived from `Signature.signed_at` for PURCHASING_MANAGER or the `PENDING_MANAGER` stage timestamp) |
| 1b | Filter by **invoice number** | Yes — via free-text search | OK | Keep; make it an exact-match option too |
| 1c | Filter by **vendor name** | Yes — vendor dropdown | OK | Keep; also show filtered **total** (see #2) |
| 1d | **Memo details / brand** | Not shown or filterable | Missing | Add `qb_memo` (memo) + `brand` columns and filters — both are already stored on the invoice |
| 1e | **Manager approval date** | Not shown | Missing | Column + filter from signatures/stage timestamps (§1a) |
| 1f | **Due date** | Not shown | Missing | Column + filter (`invoice.due_date`) |
| 1g | **Split (account)** — SAMPLE / YARNS / TRIMS etc. | Not shown; category exists on invoice but unused here | Missing | Show `category` (renamed "Split" in UI) as column + filter + optional grouping |
| 1h | **Aging** | Not shown | Missing | Computed column: days from `due_date` to today (or from `invoice_received_date`); add aging-bucket filter (0-30 / 31-60 / 60+) |
| 1i | **Open balance** | Not shown | Missing | Computed: `invoice.total_amount − sum(payments PAID)`. Today payments are full-amount, so it equals the unpaid amount; add column + filter |
| 1j | **Due-date month cut-off** — Associate picks a month/day and sees only invoices due in that month, then plans the batch from that filtered set. **Must also filter by vendor name within this view** | Filter range is on **payment_date**, not due date; no due-date filter at all | Missing | Add a "Due month" filter (e.g. `dueMonth=2026-08`) on `invoice.due_date` plus a day cut-off option ("due on/before the 15th") and the **same vendor filter applied to the due-month view**. Keep the existing payment-date range as a separate, combinable filter |
| 2 | **Filtered total** — when filtering by vendor (etc.), the total shown must match only the filtered rows | Totals exist only for *selected* payments, grouped per batch; no total of the current filtered list | Missing | Return `total_by_currency` (and row counts) with the scheduled-payments endpoint; show it above the table, recomputed per filter |
| 3 | **"Holder" for lab testing etc. included in batch** | All `SCHEDULED` payments are eligible; category plays no role | No policy for mixed categories | Add category filter + a "split" grouping option; decide + document which categories batch together (recommend: default = TRIMS/YARN only for regular batches, optional include of LAB_TESTING/SHIPPING etc. via toggle) |
| 4 | **Remarks: only Accounting Associate can add/edit** | `Payment.remarks` exists but is only set at execution; no per-invoice remarks during selection | Missing UI + API | Add `PATCH /api/payments/:id/remarks` (associate-only) + remarks input column in the schedule table; keep supervisor/others read-only |
| 5 | **Bank charge NOT applied at OCR — applied during batch, on ONE invoice only** | `invoice.bank_charges` is stored from OCR but never used in payment amounts | Missing logic + field | (a) Stop treating OCR `bank_charges` as a payment amount (informational only, or clear it); (b) add a bank-charge input at batch level applied to **one selected payment**; (c) new column `bank_charge_amount` on `Payment` (+ audit log: who added it, to which invoice); (d) batch total = payments + that charge; (e) export includes it |
| 6 | **Supervisor: view-only + remarks + bulk approve; on return → final remarks to associate** | Supervisor can review one batch at a time (`POST /:batchId/review`), has `review_note`, can return whole batch or individual invoices | No bulk approve; "final remarks" not structured | (a) `POST /api/payment-batches/bulk-review` (batchIds + note, supervisor-only) that reviews all in one action; (b) keep associate-only for select/create/submit/edit (already true in routes — enforce on remarks too); (c) when returning, persist supervisor remarks as the **final remarks** shown to the associate on the returned batch (`return_reason` already exists — add a dedicated `final_remarks` field that survives resubmission) |
| 7 | **Remarks → "For Payment" marker routes to supervisor** — Associate adds remarks and marks the invoice/payment "for payment", which sends it to the supervisor's review queue | `Payment.remarks` exists but is only set at execution; no routing marker | Missing | Add `Payment.remarks` editing (associate-only); the marker **lives in `Payment.status` itself → `FOR_PAYMENT`**. Supervisor **approves ("okay for payment") or rejects with a reason** — approval is the last approval step (payment process follows); a reject sends it back with the reason for the remarks loop |
| 8 | **Bank charge: ONE per supplier/vendor** — Associate places it on a single invoice; system must block a second bank charge for the same vendor (no double-charging) | `invoice.bank_charges` stored from OCR, never applied; no bank-charge concept in batches | Missing + guard needed | `Payment.bank_charge_amount` + uniqueness rule: one charged payment per vendor per billing cycle (batch is already single-vendor, so enforce "only one payment in a batch may carry a charge" and "vendor not already charged this month"). Audit-log who/when/which invoice |
| 9 | **Sub-$100 holding, released in the Associate's cut-off** — invoices below $100 are held; they surface **when they fall within the cut-off set by the Accounting Associate (on or before the due date)**; notifies Purchasing; proceeds only after the Purchasing Coordinator approves | Posting has a cumulative-$100 hold (`BATCH_THRESHOLD_NOT_MET` → ON_HOLD) but release is based on cumulative reaching $100, not due date; `checkBatchThreshold` in validation is disabled | Release trigger wrong + needs purchasing sign-off | Sub-$100 payments get status `HELD_BELOW_100`; **system notifies Purchasing**; invoice proceeds only after the **Purchasing Coordinator approves** (proceed for payment or consolidate); the invoice **appears in the batch view when it falls within the Associate's cut-off** (on or before `due_date`). Keep ON_HOLD + BATCH_THRESHOLD_NOT_MET exception |
| 10 | **Pay Bills / Bill Stub (no CC step)** — the batch amount is what gets paid (like QB Pay Bills); the **Accounting Associate endorses** a **bill stub** (header: date, type, reference, original amount, balance, discount, payment) to the supervisor — **tagging only** that the invoice is in payment process; NOT paid. When the **payment confirmation** arrives, the system matches invoices via the exported Excel file (or the bill stub) by reference # (amount second) → tagged **PAID**. **Supervisor approval is the final/last process — no CC (VP) check** | `PaymentConfirmation` exists (payment reference, amount) but there is no bill-stub entity, no ENDORSED state; `processPayment` marks PAID immediately | New model + workflow | New `BillStub` model (fields above + payment_id, endorsed_by/at, uploaded_by/at); payment states: SCHEDULED → ENDORSED (tagged, not paid) → PAID (on payment-confirmation match, via Excel file or bill stub); no CC approval role needed |
| 11 | **Payment schedule auto-based on due date** — Associate shouldn't type the date; the system uses `invoice.due_date` as the basis (status = "possible due date when the invoice can be paid") | `schedulePayment` requires a manually entered `paymentDate` | Auto-compute | Make `paymentDate` optional; default `payment_date = invoice.due_date`; treat SCHEDULED as the *possible* payment date, not a fixed commitment |

### Schedule table columns (target)
Current columns: `Invoice | Vendor | Amount | Payment Date | Status`. Target adds: **invoice date**, **memo details + brand**, **manager approval date**, **due date**, **split/account (SAMPLE / YARNS / TRIMS / etc.)**, **aging**, **open balance** — every column also filterable (filters 1a–1j).

### Current batch rules worth keeping
- One batch = same vendor + currency + beneficiary account + bill-to entity (`createGroupedPaymentBatches` splits mixed selections automatically). Preserve this — it protects bank-file integrity.
- Per-invoice return from a batch already exists (`return-invoices`) and resets invoices to `PENDING_ACCOUNTING`.
- `PaymentBatchStatus` flow already supports DRAFT → PENDING_SUPERVISOR_REVIEW → REVIEWED → EXPORTED_TO_BANK → PROCESSING → PROCESSED (+ RETURNED_FOR_CORRECTION, CANCELLED).

### Target end-to-end flow (with round-2 additions)
```
Invoice arrives → due_date recorded
  → auto SCHEDULED payment (payment_date = due_date, "possible payment date")
  → sub-$100 payments → HELD_BELOW_100 (Status column shows it) → notifies Purchasing
       → Purchasing Coordinator approves "proceed for payment / consolidate" → released on due date
  → Associate: due-month cut-off + vendor filter → select invoices → create batch (1 vendor/batch)
  → Associate: per-invoice remarks, mark "For Payment" (status → FOR_PAYMENT) → submit to Supervisor
  → Supervisor: bulk approve ("okay for payment") or reject with reason → back to Associate (remarks loop)
       → APPROVAL IS FINAL — no CC (VP) step
  → Associate: place bank charge (ONE per vendor, on one invoice; duplicate blocked)
  → Associate: endorse bill stub (date, type, reference, original amount, balance, discount, payment)
       to Supervisor = tagging "in payment process" → payment ENDORSED (NOT paid)
  → Payment confirmation arrives → system matches invoices via exported Excel file (or bill stub)
       by reference (amount as secondary) → tagged PAID
```

**Payment status values (single source of truth, shown in the Status column):** `SCHEDULED` (auto date = due date) · `HELD_BELOW_100` (sub-$100, held until Purchasing Coordinator approval + due date) · `FOR_PAYMENT` (associate marked ready → supervisor; supervisor approve/reject — **final**) · `ENDORSED` (bill stub endorsed by associate — in payment process, not paid) · `PAID` (on payment-confirmation match — no CC).

---

## 2. QuickBooks — options

| Option | Effort | Fit |
|---|---|---|
| **A. Manual CSV/Excel export to QB (recommended)** | 2–4 hrs | Matches the existing manual CitiBusiness flow. Generate a QB-compatible export (bills with vendor, date, amount, memo = `qb_memo`, class/account = `qb_account_class`) from `POSTED_TO_QB` invoices; associate imports it into QuickBooks and confirms. No OAuth, no tokens, no breaking changes. |
| **B. Real QuickBooks Online API (bills creation)** | 2–4 days + credentials | Needs a QB Online subscription, a developer app, OAuth2 token refresh, and a sandbox to test. Only worth it if the business wants posting to be automatic. |
| **C. Keep status-only "POSTED_TO_QB"** | 0 | Not recommended — the label is misleading and there's no artifact proving a post happened. At minimum rename the status or add an export timestamp/file. |

**Recommended path:** Option A now (a real export file + a "confirmation" step), keep Option B as a later milestone. Also remove/fix the fake `qbSyncService` (the sync-status screen currently shows phantom "success").

---

## 3. Purchasing SLA — start the clock on arrival

**Your requirement:** SLA starts as soon as the invoice enters the system (7 days), and the manager has a **different** SLA.

**Current behavior:** No SLA timer exists for `RECEIVED` / `VALIDATION_PENDING` / `EXCEPTION_FLAGGED`. The clock only starts when `createApprovalRequest` sets `PENDING_COORDINATOR`. Coordinator and Manager currently **share** one 7-day planning SLA (manager stage gets `7d − elapsed` from coordinator entry).

**Recommended change:**
1. Create a `StageTimestamp` for `RECEIVED` immediately at invoice creation (`entered_at = invoice_received_date`), `sla_hours = 7 days` — so validation time counts against purchasing SLA (it currently doesn't).
2. On handoff to `PENDING_MANAGER`, start a **fresh, independent SLA** for the manager (business to confirm the number — e.g. 5 days) instead of the shared remainder.
3. Update `SLA_LIMITS` in `packages/shared/src/validation-rules.ts` (e.g. `ARRIVAL_TO_COORDINATOR_DAYS: 7`, `PURCHASING_MANAGER_DAYS: 5`) — the reminder/escalation machinery (`slaReminderService`) already works off open stage timestamps, so reminders will follow automatically.

**Decision needed from business:** exact SLA days for coordinator (from arrival) and manager (from handoff), and whether exception-flagged time pauses or continues the clock.

---

## 4. Suggested implementation order (fastest value first)

1. **Filtered totals + new filters/columns** in the batch schedule table (brand, memo, due date, **due-month cut-off + vendor filter**, approval date, split/category, aging, open balance) — pure UI + query work, no schema change. Unblocks the monthly cut-off workflow.
2. **Auto payment date from due date** — tiny change to `schedulePayment`.
3. **Associate remarks per invoice + "For Payment" marker + supervisor approve/reject** (uses existing `Payment.remarks`; new endpoints + status flow).
4. **Supervisor bulk approve (final) + final remarks on return** — one endpoint + UI button.
5. **Bank charge at batch level** (one payment, one per vendor, duplicate guard) — small schema change (`Payment.bank_charge_amount`), export + total updates.
6. **QuickBooks export file (Option A)** + mark `qb_invoice_id` fake code as deprecated — real export artifact for posted invoices.
6b. **Reconciliation Excel for payment batches** — Excel report (batch #, invoice #, vendor, amount, currency, payment date, reference, paid date, status) for reconciling vs bank statement + payment confirmations; doubles as the Excel file the system checks to tag PAID (item 14). New `reconciliationExportService.ts` or extend `perVendorExportService`.
7. **Bill Stub + payment-confirmation matching** (new `BillStub` model, ENDORSED → PAID on confirmation match, no CC) — the largest item.
8. **Sub-$100 hold** — released in the Associate's cut-off (on or before due date), with Purchasing notification + Coordinator approval — hold/release trigger change in posting.
~~9. SLA from arrival + separate manager SLA — **disregarded by business** (removed from scope)~~

---

## 5. Files that would change

- `apps/api/src/services/paymentBatchService.ts` — filters, totals, bulk review, bank charge, remarks endpoints
- `apps/api/src/routes/paymentBatches.ts` + `controllers/paymentBatch.ts` — new endpoints + role guards
- `apps/web/src/components/PaymentBatchManager.tsx` — filters, columns, totals, remarks, bulk approve, bank-charge UI
- `packages/db/prisma/schema.prisma` — `Payment.bank_charge_amount`, optionally `PaymentBatch.final_remarks`
- `apps/api/src/services/qbSyncService.ts` → replace with export service (or wire real QBO)
- **NEW** `apps/api/src/services/reconciliationExportService.ts` (or extend `perVendorExportService.ts`) + `GET /api/payment-batches/export-reconciliation` + download button in `PaymentBatchManager`
- `packages/shared/src/validation-rules.ts` + `apps/api/src/services/{invoiceService,approvalService,slaReminderService}.ts` — SLA-from-arrival
- `apps/api/src/services/validationService.ts` — stop treating OCR `bank_charges` as payment-affecting
- **NEW** `BillStub` model (`packages/db/prisma/schema.prisma`) + routes/controller/service for bill-stub endorsement (associate) and payment-confirmation matching (no CC)
- `apps/api/src/services/postingService.ts` + `routes/paymentBatches.ts` — payment states ENDORSED → PAID on confirmation, auto due-date scheduling, sub-$100 hold w/ purchasing notification + coordinator approval
- `apps/web/src/components/PaymentBatchManager.tsx` — remarks/"For Payment" + supervisor approve/reject, bill-stub endorsement screen, bank-charge guard UI
