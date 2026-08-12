# AP Invoice System — End-to-End Findings

A complete trace of the system: every stage, every service function, and where each
engine, timer, and role plugs in. Written from the code (Aug 2026).

---

## 1. Architecture at a glance

| Layer | Location | Tech |
|---|---|---|
| Web app | `apps/web` (React + Vite, `react-router-dom`, lucide icons) | SPA |
| API | `apps/api` (Express) | Node.js + Prisma |
| Shared config | `packages/shared` (`validation-rules.ts`, `types.ts`) | TS |
| DB | `packages/db` (Prisma schema + migrations) | PostgreSQL |
| External systems | QuickBooks (manual export), NextGen (PO/MPO lookup), CitiBusiness (CSV export), SharePoint/Graph (watched folders), SMTP, Azure OAuth email polling, Supabase + Hetzner (file storage) | — |

**Core truth:** every stage of an invoice's life is recorded twice — in `AuditLog`
(`audit_logs`) and in `StageTimestamp` (per-status SLA clock). `Signature`,
`Exception`, `InvoiceWorkflowAction` records enrich the trail. There is a full
audit timeline endpoint that reconstructs an invoice's history from all of these
tables (`invoiceService.getInvoiceTimeline`).

---

## 2. The invoice lifecycle — end to end

### Stage 0 — Intake (4 ingress paths)

1. **Manual upload** — `POST /api/upload/madison` → `uploadMadisonInvoice` (controllers/upload.ts).
2. **Async upload** — `POST /api/upload/madison/async` → `uploadMadisonInvoiceAsync`
   → enqueues into `invoiceUploadQueue` (in-memory queue with `jobStore`), returns 202 + jobId;
   client polls `GET /api/upload/job/:jobId` (`getUploadJobStatus`).
3. **Email poller** — `emailIntakeService.pollAPMailbox` (Graph API, every 5 min via
   `startEmailPoller`), dedupe via `emailDuplicateService` (file hash), route to
   `processSharePointFile` / `processPowerAutomateAttachment`.
4. **Folder watchers** — `fileWatcherService.startFileWatcher` (local `/incoming-invoices`,
   every 30s) and `sharePointWatcherService.startSharePointWatcher` (SharePoint
   `IncomingInvoices`, every 30s). Both call the same `processSharePointFile`.

`processSharePointFile` (emailIntakeService.ts:406) is the shared ingestion funnel:
download → email-duplicate check → multi-invoice detection → per-invoice
`uploadMadisonInvoice` flow → move file to Processed/Error folders + SharePoint upload.

### Stage 1 — OCR / extraction (the engine chain)

Entry: `uploadMadisonInvoice` → **`analyzeInvoice(fileBuffer, mimeType)`** (ocrService.ts:1020).

Order of operations inside `analyzeInvoice`:

1. **Structured / classification check** — `structuredInvoiceService.classifyInvoiceDocument`
   (CSV/Excel/standard formats); if `isStructuredInvoice`, it parses directly and skips OCR.
2. **Multi-invoice detection** — `multiInvoiceDetector.detectMultiInvoice` on PDFs;
   if >1 invoice, `splitPdfByPageRanges` and each split goes through
   `processSingleInvoice` recursively (results aggregated under `is_multi_invoice`).
3. **Text extraction** — `extractTextFromPDF`: tries **OpenDataLoader** first (ranked #1
   in their benchmarks), falls back to **pdf2json** (client-side PDF text layer).
4. **Madison extractor (deterministic core)** — `madisonInvoiceExtractor.extractMadisonInvoiceFields`
   (3,700+ lines of vendor-specific regex/heuristics for Avery Dennison, PT Paxar, YKK, etc.).
   In **AST_SINGLE_SOURCE_MODE** (`AST_SINGLE_SOURCE_MODE` flag) the DSRS AST kernel
   (`dsrs/ast/InvoiceASTKernel.executeInvoiceExtraction`) is the single source of truth and
   the legacy extractor is *not* run (zero-leak mode — no fallback traces).
5. **Field Decision Engine** — `fieldDecisionEngine` merges per-field values from
   all available engines (deterministic extractor + AI) with a confidence score per field.
6. **AI engine chain** (fallback only when confidence is low, or for vision/bank info):
   **Groq** → **Upstage** → **Ollama (Qwen vision)** → **Gemini Vision** → **Mistral**,
   plus parallel Gemini + Qwen dual-LLM when both keys are set. `anthropicOCRService`,
   `rapidOCRService`, `qwenOCRService` are additional engine adapters.
7. **Consensus** — `consensusExtractor` (per-field majority/voting across engines).
8. **Cross-checks at extraction time**:
   - `validateLineItems` (line-item sum vs total)
   - `detectFraud` (fraud heuristics)
   - `runSelfValidation` (deterministic sanity)
   - `validateAgainstVendorHistory` (vendor history validator)
   - `poAuditService` (async PO audit)
   - PO validation vs **NextGen** via `invoiceValidationAgent.validateInvoiceAgainstPO`
     (only when NOT in AST mode).
9. **Extraction policy** — `extractionPolicyService` decides which fields need human
   review based on confidence; `continuousLearningService` (active learning + vendor templates)
   feeds corrections back into extraction.
10. **Job store / queue** — for async uploads, result is written back through `completeJob`.

**Output** is a full `OCRResult` (invoice fields + `bank_info` + OCR-detected `signatures`
from the PDF document + raw data + confidence).

### Stage 2 — Invoice creation & vendor resolution

`uploadMadisonInvoice` → **`invoiceService.createInvoice(data)`** (invoiceService.ts:175):

- **Vendor matching** — `vendorMatchingService.matchOrCreateVendor` (name + aliases;
  `matchVendor` for the strict path). A vendor not in the master list is either auto-created
  (if `allow_vendor_creation`) or rejected with "Accounting must add the vendor first".
- **Duplicate check** — hard 409 if same `vendor + invoice_number + invoice_type` already exists.
- **MPO parsing** — `parseMPOReference` splits `mpo_number` into `mpo_base_number`,
  `mpo_order_sequence`, `material_code`.
- **Line items** — each `line_item` creates an `InvoiceLine` row with
  `match_status: 'PENDING'` (matched against NextGen MPO lines later via `matchMPOLines`).
- **Initial status** — `RECEIVED`, or `PENDING_ACCOUNTING` when `accounting_preapproved`.
- OCR-detected signatures are stored as `Signature` rows with `ocr_detected: true`
  (evidence only — never count as workflow approvals).

### Stage 3 — Validation (18 rules)

`POST /api/invoices/:id/validate` → **`validationService.validateInvoice`** (validationService.ts:165).

Runs 18 rules (16 in the DB path, plus `validatePOAgainstNextGen` and
`validateVendorThreshold`), each producing pass/fail → `Exception` rows:

1. `validateVendorMatch` → `VENDOR_NOT_FOUND`
2. `validateInvoiceNumber` → `MISSING_PO_REFERENCE`
3. `validateInvoiceDate` → `OCR_LOW_CONFIDENCE`
4. `validateDueDate` → `OCR_LOW_CONFIDENCE`
5. `validateAmount` → `AMOUNT_MISMATCH`
6. `validateCurrency` (original vs USD + exchange rate) → `AMOUNT_MISMATCH`
7. `validatePaymentTerms` → `AMOUNT_MISMATCH`
8. `validateIncoterm` → `AMOUNT_MISMATCH`
9. `validateBankDetails` → `MISSING_BANK_INFO`
10. `validateSignatures` (amount-tier signature requirements) → `MISSING_SIGNATURE`
11. `checkDuplicateInvoice` (hash of vendor+number+amount+date, via `duplicateDetectionService`) → `DUPLICATE_INVOICE`
12. `checkLateSubmission` (>7 days warn, >14 days error) → `LATE_SUBMISSION`
13. `checkUrgentPayment` → `LATE_SUBMISSION`
14. `validateHandwrittenDocument` → `HANDWRITTEN_DOCUMENT`
15. `checkMissingBankInfo` → `MISSING_BANK_INFO`
16. `validateInvoiceTemplate` → `HANDWRITTEN_DOCUMENT`
17. `validatePOAgainstNextGen` (10s hard deadline; on failure = warn, never block) → `AMOUNT_MISMATCH`
18. `validateVendorThreshold` ($500k/90-day warning-only, `BLOCKING: false`) → `VENDOR_THRESHOLD_EXCEEDED`

Behavior:
- **Blocking exceptions** put the invoice in `EXCEPTION_FLAGGED`; exceptions are resolved
  by the coordinator in the Exception Manager (`exceptionService.resolveException` /
  `waiveException` — waiving is explicitly trusted to avoid infinite loops).
- **Auto-advance**: on success (or all exceptions waived/resolved), the invoice moves to
  **`VALIDATION_PENDING`** and `createApprovalRequest` is called automatically.
- **Batch threshold** is NOT checked here — sub-$100 invoices still go through the full
  workflow; the $100 vendor-consolidation hold happens at posting time (Stage 5).

### Stage 4 — Approval state machine

Entry: **`approvalService.createApprovalRequest`** (approvalService.ts:177). All invoices
must pass through the Coordinator — **auto-approval is disabled**
(`isAutoApprovalEligible` always returns false).

**Tier routing** — `determineApprovalRoute(amount, brand, brandCode, brandTier)`:

| Tier | Amount | Route (sequential) | SLA |
|---|---|---|---|
| 1 (Planning) | ≤ $2,000 | Coordinator → Purchasing Manager | **7 days shared** |
| 2 | $2,001–$99,999 | + MLO Account Holder → MLO Planning Manager → Sr. Manager GPO | 2 / 2 / 3 days |
| 3 | ≥ $100,000 | + Ms. Polly | 7 days |

- MLO Account Holder is **brand-dependent**: Edwin for `TOP_10` brands, Glecie for `OTHER`
  (`KNOWN_BRANDS` table in shared config). Unknown brand with no explicit tier →
  `MISSING_BRAND_TIER` exception → `EXCEPTION_FLAGGED`; if already WAIVED, falls back to
  the 2-step Planning route.
- **Required fields guard** — 10 fields must be present (`vendor_id`, invoice number/date,
  due date, amount, currency, brand, season, PO, MPO) before any request.

**Signature mechanics:**
- One `Signature` row per route step, `approval_status: 'PENDING'`, `invoice_revision` stamped.
- `approveInvoice(invoiceId, userId, userRole, signerName)` (approvalService.ts:575):
  - Maps user role → signable `SignatoryRole`s (`mapUserRoleToSignatoryRoles`; e.g.
    MLO_ACCOUNT_HOLDER can sign both MLO roles).
  - **Sequential enforcement**: prior unsigned signatures block the current approver.
  - **Reconfirmation guard**: a returned invoice is pinned to the original signer's name.
  - On sign: exit current `StageTimestamp` (computing `is_breached` via
    `calcWorkingHoursElapsed`), advance to next unsigned step, **recompute the PM's SLA
    as the remaining shared 7-day Planning budget**, auto-email the next approver
    (`getEmailForRole`), notify in-app.
  - Last approver → `PENDING_ACCOUNTING` + `FULLY_APPROVED` audit + accounting SLA stage.
- `rejectInvoice` (806): invalidates the rejecting signature and everything after it,
  **re-opens the last signed approver's signature** (`signed_at: null, PENDING`) and returns
  the invoice to that stage — the Coordinator inbox fix. Accounting rejection from
  `PENDING_ACCOUNTING` uses the special `rejectFromAccounting` path (returns to last signed
  approver, since `ACCOUNTING_REVIEWER` is not in the signature chain).
- `returnInvoice` (1071): returns to a prior approver without destroying history —
  `RECONFIRMATION_REQUIRED` on the target + invalidates downstream; preserves `Signature`
  history and writes `InvoiceWorkflowAction`.
- `batchApproveInvoices` (1312): loops `approveInvoice`, reports approved/error per invoice.
- `getPendingApprovals` (1254): role-scoped inbox — statuses + tier thresholds
  (`ROLE_TIER_THRESHOLD`, e.g. Ms. Polly only sees ≥ $100k) + unsigned-signature filter,
  ordered by receipt date, `take: 10`.
- `approverInboxService` provides statistics, history, waiting-for-approval lists.

**SLA plumbing:** every stage entry creates a `StageTimestamp` with `sla_hours`
(`SLA_LIMITS`: coordinator 7d, PM 7d shared, MLO 2d, MLO-PM 2d, SR 3d, Polly 7d,
accounting 7d, payment 5d; `APPROVAL_HOURS: 48`). `slaService` /
`slaReminderService.checkAndSendSLAReminders` runs hourly (and once 30s after boot):
sends reminder emails and escalations when `calcWorkingHoursElapsed > sla_hours`.
`autoResolveLowRiskExceptions` (exceptionService.ts:170) clears low-risk blockers.

### Stage 5 — Posting to QuickBooks (simulated → export)

Entry: **`postingService.postInvoice(invoiceId, userId, bypassVarianceCheck)`** (postingService.ts:151).

1. **Guards**: invoice must be `APPROVED`/`PENDING_ACCOUNTING`/`ON_HOLD`; **all signatures
   signed**; no unresolved exceptions.
2. **No vendor-cumulative hold at posting** (removed 2026-08-12 — the sub-$100 hold lives in
   `schedulePayment` as `HELD_BELOW_100` + Purchasing release approval). The only
   batch-threshold exception handled here is the auto-resolve of a manually held invoice's
   `BATCH_THRESHOLD_NOT_MET` when it is being posted.
3. **Pre-post check** (`prePostCheck`, deterministic, no AI):
   - GL account lookup — `deriveGLAccount(invoice_type)` (7-type map; unknown → block).
   - QB memo — `deriveQBMemo` = `brand_code_season_order_type_mpo_date`.
   - **NextGen amount-variance vs PO/MPO** with a 10s hard deadline: >5% variance = block,
     >2% = warn, NextGen down = warn only. `bypassVarianceCheck` filters `AMOUNT_VARIANCE`
     flags (Accounting Supervisor bypass).
   - Blocking flags create exceptions (`[PRE-POST BLOCK] …` prefix; already-acknowledged
     flags are skipped to avoid an ON_HOLD loop) → invoice `ON_HOLD`, PENDING_ACCOUNTING
     SLA clock stopped, audit `PRE_POST_CHECK_FAILED`.
4. **`postToQuickBooks`**: NO live API call (see Finding F1). Builds the QB payload
   (per-MPO line groups with line counts) and returns `qbInvoiceId: null`; the audit note
   says the bill is ready for manual import via the QB Bills export. The **real artifact is
   `qbExportService.exportQBBills`** → `GET /api/qb/export` → `qb-bills-<date>.xlsx`
   (QB Bills + Bill Lines + Summary sheets) which the Associate imports manually.
5. Status → `POSTED_TO_QB` (`qb_posted_at`), audit `POSTED`, new stage timestamp
   (payment SLA), notify.
6. **Auto-schedule** — `schedulePayment(invoiceId, undefined, userId)` fires immediately
   (no manual Schedule Payment modal; failure is logged and the invoice stays POSTED_TO_QB).

### Stage 6 — Payment scheduling & the hold

**`postingService.schedulePayment`** (postingService.ts:508):

- **Payment date auto-derives from `invoice.due_date`** (falls back to today when no due
  date). `payment_date_source` records `DUE_DATE` / `MANUAL` / `DEFAULT` explicitly.
- **Sub-$100 hold (item 8)**: `amount < $100` → payment created `HELD_BELOW_100`
  (not `SCHEDULED`); **Purchasing is notified** (in-app, `PURCHASING_COORDINATOR`,
  warning, release guidance). Held payments appear in the schedule only within the
  Associate's cut-off window (due on or before cut-off); full review queue via the
  `HELD_BELOW_100` status filter.
- **Release** — `paymentBatchService.approveHeldPayment` (Purchasing Coordinator only):
  `HELD_BELOW_100 → SCHEDULED`, audit `HELD_BELOW_100_APPROVED`, Associate notified.
- Invoice → `PAYMENT_SCHEDULED`; audit + stage timestamp (5-day SLA).

Payment statuses in use: `SCHEDULED` → `FOR_PAYMENT` (Associate marks with remarks)
→ `APPROVED_FOR_PAYMENT` (Supervisor approves all/bulk) or back to `SCHEDULED`
(`rejectPaymentForPayment` with final remarks on return) — plus `HELD_BELOW_100`,
`ENDORSED`, `PAID`.

### Stage 7 — Payment batches (module: `PaymentBatchManager`, service: `paymentBatchService`)

- **Scheduled payments view** — `getScheduledPaymentsForBatch(filters)`:
  due-month / date cut-off, invoice date, invoice number, vendor name, memo details
  (brand), approval date, due date, split/account name, aging, open balance; **filtered
  totals** recompute from the filtered set (vendor-filtered total included). Payments
  show `payment_date` with a tooltip when derived from `invoice.due_date`. Overdue banner
  shortcuts to the aging filter.
- **Select → batch** — `selectPaymentsForBatch` / `deselectPaymentsForBatch`; then
  `createPaymentBatch` (single vendor+currency+beneficiary+legal-entity per batch) or
  `createGroupedPaymentBatches` (auto-splits mixed selections into per-vendor batches).
  Batch starts `DRAFT`.
- **Remarks & FOR_PAYMENT** — `setPaymentRemarks` (Associate-only edit) →
  `markPaymentForPayment` (`FOR_PAYMENT`) → Supervisor: `approvePaymentForPayment`
  (per payment), `bulkApprovePaymentsForPayment` (all at once, final), or
  `rejectPaymentForPayment` (returns with final remarks → `SCHEDULED`). There is no CC
  check — **Supervisor approval is the last step before the payment process.**
- **Review flow** — `submitPaymentBatchForReview` (DRAFT/RETURNED →
  `PENDING_SUPERVISOR_REVIEW`) → `reviewPaymentBatch` (`REVIEWED`, note) /
  `returnPaymentBatch` (`RETURNED_FOR_CORRECTION`, reason) →
  `markPaymentBatchExported` (`EXPORTED_TO_BANK`) → bank file download.
- **Bank charge (one per vendor per batch)** — `applyBankCharge(batchId, paymentId,
  amount, note)`: sets `bank_charge_amount` on ONE payment; duplicates blocked
  (remove first); `batch.total_amount` recomputed = payments + charge (flows into list
  cards, stats, exports). `removeBankCharge` restores the total.
- **Bill Stub** — `endorseBillStub` (Associate; REVIEWED/EXPORTED_TO_BANK): creates/upserts
  `BillStub` (stub date, type, reference, original amount, balance, discount, payment),
  optional proof file, payment → **`ENDORSED`** (not paid).
- **Payment confirmation match** — `matchPaymentConfirmation`: `ENDORSED` payments → **PAID**
  only when a confirmation arrives, matched by **reference** with **amount as tiebreak**
  (ambiguous → 400 with explicit-select instruction from the exported Excel); sets `paid_at`,
  reference, invoice → `PAID`; **batch auto-`PROCESSED` when all payments PAID**.
- **Cancellation / returns** — `cancelPaymentBatch` (unlinks payments, status
  `CANCELLED`); `returnInvoicesFromBatch` (individual invoices back to
  `PENDING_ACCOUNTING`, batch total/count recomputed; empty batch → cancelled).
- **Auto Wednesday batch** — `autoCreateWednesdayBatch` helper exists (weekly cut-off).

### Stage 8 — Exports & reports

| Export | Function / endpoint | Contents |
|---|---|---|
| Per-vendor batch Excel | `perVendorExportService.exportBatchPerVendor` | Per-vendor file with **Bank Charge column**, TOTAL row = payments + charge, Summary (payments / charge / incl. charge) |
| QB Bills | `qbExportService.exportQBBills` → `GET /api/qb/export` | QB Bills + Bill Lines (grouped by MPO) + Summary; GL/memo derived by the same functions posting uses; status/date filters |
| Reconciliation | `reconciliationExportService.exportPaymentReconciliation` → `GET /api/payment-batches/reconciliation` | Payments (with Bank Charge + Total incl. Charge + per-currency TOTAL rows), Bank Charges sheet, Batches summary |
| CitiBusiness | `citibusinessExportService.exportBatchToCitiBusiness` / `exportMultipleBatchesToCitiBusiness` | Bank CSV for CitiBusiness manual import |
| Aging | `agingReportService` (generateAgingReport, generateVendorAgingReport, getAgingSummary, getAgingReportByDateRange) | Aging buckets by due date |
| Operational | `reportService` (invoice volume, payment status, vendor spending, exception rate, KPI, forecast) | Dashboards |
| SLA | `slaAnalyticsService` / `slaDashboardService` (SLADashboardReport, trends, breaches by stage) | SLA analytics |
| Bank matching | `bankMatchingService` (compareBankDetails, autoCheckBankDetails, recheck vs QB) | Bank-detail verification |
| SOA | `soaReconciliationService` (queue by year/month, markAsReviewed) | Statement reconciliation |
| PI follow-up | `piFollowUpService` (paid-PI missing CI, auto follow-ups, record CI) | CI chasing |
| Low value | `lowValueQueueService` (queue, confirm, reject) | Sub-threshold queue |

### Stage 9 — Reconciliation & close-out

PAID → optional `sendPaymentConfirmationToSupplier` email (vendor contact on file),
`autoCreateCIFollowUpTask` (PI follow-up), and the reconciliation export ties the batch
grand totals (payments + bank charge) to the bank statement. Invoices can be re-processed
anywhere via `reprocessService` (`reprocessInvoice`, `reExtractInvoice`,
`reExtractInvoices`, `downloadInvoicePdf`).

---

## 3. Role-based access

| Role | Primary surface | Notes |
|---|---|---|
| `PURCHASING_COORDINATOR` | Approval Inbox (stage 1), Exception Manager, **release HELD_BELOW_100** | All invoices must pass here first |
| `PURCHASING_MANAGER` | Approval Inbox (stage 2) | Shares 7-day planning SLA |
| `MLO_ACCOUNT_HOLDER` / `MLO_PLANNING_MANAGER` / `PLANNING_MANAGER` | Approval Inbox (stages 3–4) | Edwin (TOP_10) / Glecie (OTHER); same person can sign both MLO roles |
| `SR_MANAGER_GLOBAL_PRODUCTION` | Approval Inbox (stage 5) | ≥ $2,000 |
| `MS_POLLY` | Approval Inbox (stage 6) | ≥ $100,000 |
| `ACCOUNTING_ASSOCIATE` | Payment Batches (schedule, select, create, remarks, FOR_PAYMENT, bank charge, endorse, match), QB export, upload confirm | Edits remarks; applies bank charge; endorses bill stubs |
| `ACCOUNTING_SUPERVISOR` | Payment Batches review (approve all/bulk, return w/ final remarks, export to bank), Accounting Review, posting, release-from-hold, bypass variance | **Final approver before the payment process** — no CC check |
| `CFO` / `PRESIDENT` | Accounting review / oversight | Can sign `ACCOUNTING_REVIEWER` |
| `IT_ADMIN` / `SUPERADMIN` | User management, settings, everything | |
| `CC_REPORTS` / `INVOICE_UPLOADER` | Reports / upload only | |

Frontend routes are public unless wrapped in `ProtectedRoute`; actual authorization is
enforced server-side via the `authorize(...roles)` middleware on each route
(e.g. bank charge = Associate; approve-held = Purchasing Coordinator; QB export =
Associate/Supervisor/IT).

---

## 4. Background jobs & timers (all in `apps/api/src/index.ts`)

| Job | Interval | Function |
|---|---|---|
| SharePoint watcher | 30s | `sharePointWatcherService.startSharePointWatcher` |
| Local folder watcher | 30s | `fileWatcherService.startFileWatcher` |
| Email poller | 5 min | `emailIntakeService.startEmailPoller` (Graph) |
| SLA reminders | 1h (+30s after boot) | `slaReminderService.checkAndSendSLAReminders` |
| Ollama model pre-load | on boot | Warm-up request |
| MPO cache pre-load | on boot (disabled by default) | `nextGenService.preloadMPOCache` — 15k+ headers, 5+ min; deliberately off, 10s timeout instead |

Graceful shutdown stops watchers + interval on SIGTERM/SIGINT.

---

## 5. Key data model highlights

- **Invoice** — status, `approval_tier`, `current_approver_role`, `revision`,
  `parent_invoice_id` (multi-invoice split parents), full OCR provenance
  (`ocr_raw_data`, `source_document_type`, `structured_source_format`,
  `document_layout_fingerprint`), `mpo_base_number`/`mpo_order_sequence`/`material_code`,
  `qb_memo`/`qb_account_class`, `qb_posted_at`.
- **InvoiceLine** — `match_status: 'PENDING'` → matched vs NextGen MPO lines; `size` added
  in a recent migration.
- **Signature** — `ocr_detected` (evidence, never workflow), `invoice_revision`,
  `approval_status` (PENDING / APPROVED / RECONFIRMATION_REQUIRED / SUPERSEDED),
  `invalidated_at`/`invalidated_reason`.
- **StageTimestamp** — every status entry/exit with `sla_hours` + `is_breached` (SLA truth).
- **Exception** — PENDING / RESOLVED / WAIVED with resolution audit.
- **Payment** — `payment_date_source` (DUE_DATE/MANUAL/DEFAULT), `bank_charge_amount` +
  `bank_charge_note` (one per vendor per batch), `bill_stub` 1:1, selection fields,
  `selected_by` concurrency guard.
- **PaymentBatch** — status machine DRAFT → PENDING_SUPERVISOR_REVIEW →
  REVIEWED → EXPORTED_TO_BANK → (PROCESSING) → PROCESSED, with RETURNED_FOR_CORRECTION
  and CANCELLED branches; review/return/cancel attribution fields.
- **BillStub** — QB Pay Bills header per payment (stub date, type, reference, original
  amount, balance, discount, payment) + proof file.
- **InvoiceWorkflowAction** — stage-to-stage action log (returns, rejections).
- **APInvoice_BillStub**, `payment_date_source`, `bank_charge_*` are the newest columns
  (migrations applied to prod on 2026-08-11).

---

## 6. Findings & observations

**F1 — QuickBooks posting is simulated by design, not by accident.** `postToQuickBooks`
builds the QB payload but never calls the API (`qbInvoiceId: null`, "TODO: Implement actual
QuickBooks Online API call"). The workflow is: post → mark POSTED_TO_QB → download
`qb-bills-<date>.xlsx` → manual import in QB. There is no OAuth/token storage anywhere.
If real one-click QBO sync is wanted, that is a separate project (OAuth + token storage +
webhooks); the export file already carries vendor, amount, memo, GL account, GL class.

**F2 — The sub-$100 hold is scheduling-time `HELD_BELOW_100` (decision 2026-08-12).** There
were two overlapping mechanisms: (a) a legacy posting-time vendor-cumulative auto-hold
(`ON_HOLD` + `BATCH_THRESHOLD_NOT_MET` in `postInvoice`) and (b) the scheduling-time
per-invoice `HELD_BELOW_100` + Purchasing release. The business confirmed **HELD_BELOW_100 is
the correct mechanism**, and the posting-time auto-hold was **removed from `postInvoice`**
(2026-08-12): a fully approved sub-$100 invoice now always posts, and the hold happens at
scheduling with the Associate's cut-off + Purchasing Coordinator release approval. The
manual hold endpoint (`POST /api/invoices/:id/hold`, Accounting-only) remains as a general
operator tool, and its `BATCH_THRESHOLD_NOT_MET` exceptions are still auto-resolved when the
invoice posts.

**F3 — No CC (CFO/VP) check on payments.** Supervisor approval is the terminal gate before
the payment process; the "no checking kay CC — supervisor approval is the last process"
requirement is implemented as-is. If CC sign-off returns, a batch status would need to be
inserted between REVIEWED and EXPORTED_TO_BANK.

**F4 — PAID is tagged by matching, not by bank response.** `matchPaymentConfirmation`
matches ENDORSED payments by reference (amount as tiebreak) from the exported Excel or the
bill stub; there is no bank API/webhook. This matches the stated design ("pag na approve na
ni CC… doon matatag na as paid") but means PAID is only as accurate as the confirmation file.

**F5 — NextGen coupling is heavily defended but still a SPOF for validation.** PO/MPO
lookups everywhere carry a 10s deadline and degrade to warn (never block), and the MPO
cache preload is disabled to avoid a 5-minute boot hang. But the system's PO-matching,
variance, and line-matching logic all assume NextGen's paginated grid API keeps working;
a NextGen credential or API change silently downgrades validation quality (PO_NOT_FOUND
warnings everywhere).

**F6 — Extraction is deep but complex.** Five+ AI engines, a 3,700-line legacy extractor,
a DSRS AST kernel, a field decision engine, a consensus extractor, vendor-history and
fraud checks — with AST_SINGLE_SOURCE_MODE able to disable the legacy extractor entirely.
The complexity is intentional (ranked benchmarks, per-vendor templates, active learning)
but means extraction behavior differs by environment flag; the mode flag is the single
biggest behavioral lever in the system.**F7 — The async upload queue is disk-backed and survives restarts (verified).** Corrected after the original study overstated this as an in-memory gap: `invoiceUploadQueue` writes each upload's metadata (`.json`) and payload (`.bin`) to `data/invoice-upload-queue/` and `start()` recovers pending payloads on boot; `jobStore` persists to `data/async-jobs.json` (atomic write) and marks interrupted `processing` jobs as failed. Verified end-to-end with a two-process test (process A enqueues, process B recovers and completes). Hardened (2026-08-12): failed payloads are retried on restart **up to `INVOICE_MAX_RETRIES` (default 3)** then failed permanently and removed; corrupt metadata / missing `.bin` fail immediately instead of wedging the queue; stale payloads older than `INVOICE_QUEUE_RETENTION_MS` (default 7 days) plus orphan halves are purged at boot. The one real gap left is **no cross-instance claim**: two API instances draining the same queue dir would double-process — safe only while the API stays single-instance (the current VPS deployment). If horizontal scaling is planned, move the queue to Postgres with `UPDATE … WHERE status='queued'` claim semantics.

**F8 — SLA breach is computed on exit, reminders on schedule.** `is_breached` is only
finalized when a stage exits (approve/reject/hold); `slaReminderService` runs hourly to
proactively nudge before that. Breach analytics (`slaDashboardService`) reads the same
stage timestamps. No stage runs a background "auto-escalate" that changes state — escalation
is notification-only.

**F9 — Role→signatory mapping is a single source in one function.**
`mapUserRoleToSignatoryRoles` (approvalService) is where role-to-signature authority is
defined; `ROLE_TIER_THRESHOLD` and `getPendingApprovals` mirror it. Adding a new signing
role (e.g., a second coordinator) touches one place, but the email mapping
(`getEmailForRole`) is env-var driven with placeholder defaults — real per-approver routing
lives in the in-app notification layer.

**F10 — Audit is thorough and centralized.** Every state change writes `AuditLog` with a
human-readable note; `InvoiceWorkflowAction` adds structured stage-to-stage transitions;
`getInvoiceTimeline` reconstructs a full chronological story. This is the strongest part of
the system for compliance.

**F11 — Deployment coupling.** The web app must be deployed only after the API's DB
migrations are applied (see `docs/DEPLOY_RUNBOOK.md` §4.5 — the migration-gap checklist,
updated after the 2026-08-11 incident where 4 migrations were missing from prod).

**F12 — Accounting rejection used to strand invoices at the returned stage (fixed
2026-08-12).** `rejectFromAccounting` moved the invoice back to the last signed approver
(e.g. `PENDING_MANAGER`) but left that approver's `Signature` row `signed_at` and
un-invalidated, so `approveInvoice` could never find a pending signature for the role and
threw `No pending approval found for this role` — the invoice was stuck forever at
`PENDING_MANAGER` with no way to re-approve. Found live by the end-to-end QA
(extraction → approval → reject/return → posting → batch → PAID), fixed by re-opening the
last approver's signature in `rejectFromAccounting` exactly like the regular reject path
(`signed_at: null`, `approval_status: 'PENDING'`, invalidated + reason), and re-verified
live: Accounting reject → `PENDING_MANAGER` → Manager re-approve → `PENDING_ACCOUNTING`.
Two regression tests cover the re-open and the no-prior-approver fallback. **This fix ships
with the next API deploy to the VPS (the deployed build predates it).**

---

## 7. The full happy path in one paragraph

A PDF arrives via upload, email, SharePoint, or SFTP → multi-invoice detection splits it →
OpenDataLoader/pdf2json extracts text → the Madison extractor (or DSRS AST in
single-source mode) pulls fields, AI engines back it up per-field, consensus resolves
conflicts → the vendor is matched/created and the invoice created (RECEIVED) with line
items → 18 validation rules run; blockers become exceptions for the coordinator → all
fields + exceptions OK → VALIDATION_PENDING → approval request creates the tiered
signature chain (Planning 7d shared / +MLO+SR / +Polly) → sequential approvals with SLA
timestamps, emails, and in-app notifications → PENDING_ACCOUNTING → Accounting posts
(pre-post check only; the $100 hold happens at scheduling) → POSTED_TO_QB → payment
auto-scheduled from the due date (sub-$100 → HELD_BELOW_100 until Purchasing releases) → Associate selects
payments, sets remarks, marks FOR_PAYMENT → Supervisor bulk-approves (final) → batch
DRAFT → PENDING_SUPERVISOR_REVIEW → REVIEWED → EXPORTED_TO_BANK → bank charge applied
(one per vendor) → QB Bills + CitiBusiness + per-vendor files downloaded → Associate
endorses the bill stub (ENDORSED) → payment confirmation matches by reference
(amount tiebreak) → PAID, batch PROCESSED → reconciliation export ties totals to the
bank statement → optional supplier email + CI follow-up. Every hop leaves an audit log,
a stage timestamp, and notifications.
