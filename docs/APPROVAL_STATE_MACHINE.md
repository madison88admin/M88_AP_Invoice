# Invoice Approval State Machine

Source of truth for the approval workflow. Backed by `apps/api/src/services/approvalService.ts`,
`validationService.ts`, `postingService.ts`, `exceptionService.ts`, and `slaReminderService.ts`.
Config values live in `packages/shared/src/validation-rules.ts` (`APPROVAL_THRESHOLDS`, `SIGNATURE_REQUIREMENTS`, `SLA_LIMITS`).

## Statuses (in workflow order)

| Status | Meaning |
|---|---|
| `RECEIVED` | Invoice created (upload confirm, email, SharePoint, SFTP watcher) |
| `OCR_PROCESSING` | Defined in enum; **not used** by the current workflow |
| `VALIDATION_PENDING` | Validation passed; ready for approval request |
| `EXCEPTION_FLAGGED` | Validation failed or approval route could not be determined |
| `PENDING_COORDINATOR` | Coordinator's turn |
| `PENDING_MANAGER` | Purchasing Manager's turn |
| `PENDING_MLO_ACCOUNT_HOLDER` | MLO Account Holder's turn (Edwin/Glecie) |
| `PENDING_MLO_PLANNING_MANAGER` | MLO Planning Manager's turn |
| `PENDING_SR_MANAGER` | Sr. Manager Global Production's turn |
| `PENDING_POLLY` | Ms. Polly's turn (Tier 3 only) |
| `PENDING_ACCOUNTING` | All purchasing approvals complete; accounting review/posting |
| `APPROVED` | Legacy / edge status: set by PI follow-up and low-value queue; **read** by reports and accepted by posting, but the main chain lands on `PENDING_ACCOUNTING` |
| `POSTED_TO_QB` | Posted to QuickBooks |
| `PAYMENT_SCHEDULED` | Payment record scheduled |
| `PAID` | Payment executed |
| `PAYMENT_CONFIRMATION_SENT` | Remittance confirmation sent to vendor |
| `REJECTED` | Terminal — invoice stopped (enum value; current reject logic instead **returns to prior approver**) |
| `ON_HOLD` | Accounting-only hold (batch threshold or manual) |

## State diagram

```
                    ┌──────────────┐
                    │   RECEIVED   │◄── createInvoice / watchers / email
                    └──────┬───────┘
                           │ validateInvoice (auto after create, or manual)
              ┌────────────┴─────────────┐
              ▼                          ▼
     EXCEPTION_FLAGGED            VALIDATION_PENDING
              │  resolve/waive all          │ createApprovalRequest (auto)
              └────────────►───────────────┘
                                           ▼
                                  PENDING_COORDINATOR ──approve──► PENDING_MANAGER ──approve──► (Tier 2/3)
                                                                                                   │
                                             PENDING_MLO_ACCOUNT_HOLDER ──► PENDING_MLO_PLANNING_MANAGER ──► PENDING_SR_MANAGER
                                                                                                   │
                                                                          (Tier 3) PENDING_POLLY ◄──┘
                                                                                                   │ all signed
                                                                                                   ▼
                                           ┌────────────────────────────────────────── PENDING_ACCOUNTING
                                           │                │ approve/reject (accounting) │ post
                                           ▼                ▼                             ▼
                                         ON_HOLD ◄──hold── PENDING_ACCOUNTING ◄─release─► POSTED_TO_QB
                                           │                                             │ schedule payment
                                           └────────────────────────────────────────────► PAYMENT_SCHEDULED
                                                                                             │ process payment
                                                                                             ▼
                                                                                           PAID
                                                                                             │ send confirmation (Supervisor)
                                                                                             ▼
                                                                                    PAYMENT_CONFIRMATION_SENT

  reject anywhere in the chain ──► re-opens last prior signed approver's stage (not REJECTED)
  return (correction) ───────────► selected prior approver's stage, signatures set RECONFIRMATION_REQUIRED
```

## Transitions and who can trigger them

### 1. Entry → `RECEIVED`
- **Who:** `createInvoice` (manual upload confirm, Coordinator/IT Admin), email intake, SharePoint watcher, SFTP file watcher.
- Accounting pre-approved uploads (`accounting_preapproved=true`, Associate only, Lab Testing / Shipping / Factory Audit / Consulting categories) skip straight to **`PENDING_ACCOUNTING`**.
- Watchers may create **`EXCEPTION_FLAGGED`** directly (low OCR confidence, vendor not found).

### 2. `RECEIVED` → `VALIDATION_PENDING` / `EXCEPTION_FLAGGED` — `validateInvoice()`
- **Who:** auto — `createInvoice` fires `setImmediate(validateInvoice)`; manual — `POST /api/invoices/:id/validate` (Coordinator, IT Admin; async job-polled variant same auth).
- 18 rules; failures become consolidated `Exception` rows (previously-waived reasons are not re-created).
- New exceptions → **`EXCEPTION_FLAGGED`**. Clean pass (or only previously-waived failures) → **`VALIDATION_PENDING`**, then **auto-calls `createApprovalRequest`** unless `skipAutoAdvance`.
- Re-validation of any stage from `PENDING_COORDINATOR` onward is **locked** (400).

### 3. `VALIDATION_PENDING` → first approver stage — `createApprovalRequest()`
- **Who:** auto (from validation) or `POST /api/invoices/:id/request-approval` (Coordinator, IT Admin, SUPERADMIN).
- Hard requirements (400 if missing): vendor, invoice number, invoice date, due date, amount, currency, brand, season, PO number, base MPO.
- **Tier routing** (`determineApprovalRoute`):
  - **Tier 1 (Planning) ≤ $2,000:** Coordinator → Purchasing Manager (shared 7-day SLA)
  - **Tier 2 $2,001–$99,999:** + MLO Account Holder (Edwin for TOP_10, Glecie for OTHER) → MLO Planning Manager → Sr. Manager Global Production
  - **Tier 3 ≥ $100,000:** + Ms. Polly
  - Tier 2+ requires a known brand or an explicit `brand_tier`; otherwise the invoice is pushed to **`EXCEPTION_FLAGGED`** with a `MISSING_BRAND_TIER` exception (unless already waived → default Tier-1 route).
- Creates one `Signature` row per route step (`PENDING`, unsigned) and sets invoice to the **first unsigned step's** `PENDING_*` status + `current_approver_role`.
- Idempotent (in-flight map + route-already-initialized recovery). Auto-approval path exists but is **disabled** (`isAutoApprovalEligible` always returns false).

### 4. Stage → stage — `approveInvoice()` — `POST /api/invoices/:id/approve`
- **Who (role guard):** Coordinator, Purchasing Manager, MLO Account Holder, Planning Manager, Sr. Manager GPO, Ms. Polly, President, Accounting Supervisor, Accounting Associate.
- Role → signatory mapping (`mapUserRoleToSignatoryRoles`): MLO Account Holder may sign **both** MLO steps; Accounting/CFO/President map to `ACCOUNTING_REVIEWER`.
- Enforces **FIFO**: the first unsigned signature in chain order must be the one being signed (`403 waiting for prior approval(s)`).
- Signs the signature (DIGITAL, `APPROVED`), **exits the current stage timestamp** (computes `is_breached`), then advances to the next unsigned step's `PENDING_*` status and notifies that approver by email.
- Last signature → **`PENDING_ACCOUNTING`** (`current_approver_role` cleared; "APPROVED" appears only in notifications/reports).
- `RECONFIRMATION_REQUIRED` signatures can only be signed by the original signer (403 otherwise).

### 5. Rejection — `rejectInvoice()` — `POST /api/invoices/:id/reject`
- **Who:** same approver role set.
- Invalidates signatures from the rejecting approver onward; **re-opens the last prior signed approver's signature** (`signed_at=null`, `PENDING`) and returns the invoice to that stage (`PENDING_COORDINATOR` fallback if none). Creates a fresh stage timestamp.
- Accounting rejecting from `PENDING_ACCOUNTING` (`rejectFromAccounting`) returns the invoice to the **last signed approver's stage** without re-opening their signature.
- Note: the workflow does **not** land on `REJECTED`; it loops back for correction.

### 6. Return for correction — `returnInvoice()` — `POST /api/invoices/:id/return`
- **Who:** Purchasing Manager, MLO Account Holder, Planning Manager, Sr. Manager GPO, Accounting Associate/Supervisor.
- Current pending approver returns the invoice to a prior signed approver (default = nearest prior signed; optional `targetRole`). Signatures from the target onward are reset to `RECONFIRMATION_REQUIRED`; invoice + stage timestamp move to the target's stage. Audit + `InvoiceWorkflowAction` rows recorded.

### 7. `EXCEPTION_FLAGGED` → back into flow — `exceptionService`
- **Who:** `POST /api/exceptions/:exceptionId/resolve|waive` (roles per route config; exceptions route).
- When the **last pending** exception is resolved/waived: invoice → **`VALIDATION_PENDING`** (no revalidation), coordinator can request approval. Resolve-with-auto-advance revalidates with `skipAutoAdvance` semantics to keep control with the coordinator.

### 8. Posting & payment — `postingService`
- `POST /api/invoices/:id/post` (Accounting Associate, Accounting Supervisor, IT Admin): accepts `APPROVED`, `PENDING_ACCOUNTING`, `ON_HOLD`; requires all signatures signed and no unresolved exceptions; **accounting batch threshold** ($100 cumulative per vendor) can put it **`ON_HOLD`** with a `BATCH_THRESHOLD_NOT_MET` exception; variance check (Supervisor can bypass) → exits `PENDING_ACCOUNTING` stage → **`POSTED_TO_QB`**.
- `POST /api/invoices/:id/hold` / `release-hold` (Accounting only): `PENDING_ACCOUNTING` ↔ **`ON_HOLD`**.
- `POST /api/invoices/:id/schedule-payment` (Associate, Supervisor): `POSTED_TO_QB` → **`PAYMENT_SCHEDULED`** (creates `Payment` record).
- `POST /api/payments/:paymentId/process`: payment → `PAID`, invoice → **`PAID`**.
- `POST /api/invoices/:id/send-payment-confirmation` (**Supervisor only**): `PAID` → **`PAYMENT_CONFIRMATION_SENT`** (emails vendor, records `PaymentConfirmation`).

### 9. Generic override — `PATCH /api/invoices/:id/status`
- **Who:** Coordinator, IT Admin. Bare status write + `STATUS_UPDATED` audit; does not touch signatures/stage timestamps. Use sparingly.

## Pending-inbox visibility (`getPendingApprovals`)

- Queried by the role's pending statuses only (it must be that role's turn).
- Amount thresholds hide out-of-tier invoices: MLO/Planning/Sr. Manager see only > $2,000; Ms. Polly only > $100,000.
- FIFO ordering by `invoice_received_date`, `created_at`, `id`; capped at 10.

## SLA timers

**Mechanism:** every stage entry creates a `StageTimestamp` (`entered_at`, `sla_hours = role_days × 24`); every exit stamps `exited_at` and `is_breached` (computed with `calcWorkingHoursElapsed` — working-hours aware).

**Limits (`SLA_LIMITS`):** Coordinator 7d · Purchasing Manager 7d · MLO Account Holder 2d · MLO Planning Manager 2d · Sr. Manager GPO 3d · Ms. Polly 7d · Accounting 7d · Payment 5d.

**Shared Planning SLA:** when the invoice advances to `PENDING_MANAGER`, the stage's `sla_hours` is set to `7 days − elapsed hours since PENDING_COORDINATOR entered` (min 1h) — Coordinator + Manager share one 7-day budget, not 7 days each.

**Reminder scheduler (`slaReminderService.checkAndSendSLAReminders`)** — hourly `setInterval` in `index.ts` (+ one run 30s after boot), scans all open stage timestamps:
- ≤ 48h remaining → `2_DAYS` reminder email to the stage approver.
- ≤ 24h remaining → `1_DAY` URGENT reminder (manager CC'd).
- ≤ 0 remaining → **BREACH escalation**: `PENDING_MANAGER` and `PENDING_SR_MANAGER` escalate to **VP of Operations (Chris A)**; all other stages escalate to **Accounting Supervisor**; stage marked `is_breached`.

**Where stage timestamps are created/exited:** entry — `createApprovalRequest` (first stage + skipped auto-signed stages), `approveInvoice` (next stage), reject/return re-entries, `postingService` (post/schedule/pay/hold/release); exit — `approveInvoice`, `rejectInvoice`, `rejectFromAccounting`, `returnInvoice`, `postingService`.

## Key files

| Concern | File |
|---|---|
| Tier config, signature requirements, SLA limits | `packages/shared/src/validation-rules.ts` |
| Route determination, approval/reject/return, pending inbox | `apps/api/src/services/approvalService.ts` |
| Validation rules, auto-advance, batch threshold | `apps/api/src/services/validationService.ts` |
| Stage timestamps, SLA breach queries | `apps/api/src/services/slaService.ts` |
| Hourly reminders + escalations | `apps/api/src/services/slaReminderService.ts` |
| Posting, holds, scheduling, payment | `apps/api/src/services/postingService.ts` |
| Exception resolution re-entry | `apps/api/src/services/exceptionService.ts` |
| HTTP handlers | `apps/api/src/controllers/{approval,validation,posting}.ts`, routes in `apps/api/src/routes/invoices.ts` |
