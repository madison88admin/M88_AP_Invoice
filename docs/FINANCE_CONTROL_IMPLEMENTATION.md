# Finance Control Implementation and Current-State Workflow

## End-to-end control flow

1. Email, SharePoint, SFTP, or manual upload stores the original document and creates a durable job.
2. OCR job moves through `queued`, `processing`, `retrying`, `completed`, `failed`, or `dead_letter`; payload and retry metadata survive API restart.
3. Extraction creates one invoice and line records. Duplicate content hash and normalized vendor/invoice number checks run before approval.
4. Required-field gate blocks approval when the PDF, vendor, invoice identity, amount/currency, terms/due date, or PO-line fields are incomplete.
5. Every PO invoice line must map to a distinct NextGen MPO line using MPO, sequence, and material. Header-only success cannot satisfy line validation.
6. Quantity, UOM, unit price, line amount, MPO subtotal, invoice total, prior-invoiced balance, and remaining quantity/amount are reconciled deterministically.
7. Validation returns canonical states: `MATCHED`, `WITHIN_TOLERANCE`, `MISMATCH`, `INCOMPLETE`, `UNAVAILABLE`, or `NOT_APPLICABLE`. The legacy `passed` property remains temporarily for shadow compatibility.
8. Material edits increment the invoice revision and invalidate stale signatures and NextGen validation.
9. Purchasing approval proceeds on the current revision. Rejection returns to the recorded coordinator for correction and resubmission.
10. Accounting validates vendor/bank information. Bank changes require a different Accounting Supervisor; payment preparation freezes an immutable bank snapshot.
11. Payment batches enforce maker-checker separation, current revision, approved state, exception clearance, and duplicate-payment prevention.
12. Nightly deterministic anomaly and four-way reconciliation runs persist findings for Accounting/CFO review.

## Ownership

- Purchasing: invoice/PO correctness and approval. It cannot place payment holds.
- Accounting Associate: accounting review, payment preparation, and execution subject to separation rules.
- Accounting Supervisor: bank-change approval, held-payment release, and payment-batch review.
- CFO: Finance-control oversight and reconciliation access.

## Shadow rollout flags

- `FINANCE_CONTROLS_SHADOW_MODE=true`: report new findings without changing workflow status.
- `FINANCE_RECONCILIATION_INTERVAL_MS=86400000`: nightly interval.
- `INVOICE_MAX_RETRIES=3`: retry budget before dead letter.
- Finance tolerance environment variables are documented in `financePolicyService.ts`; production defaults should remain zero except rounding tolerances.

No production migration, backup, or rollout is considered complete from repository code alone.

## Durable staging controls

- DB-backed validations retain immutable, fingerprinted NextGen evidence snapshots tied to invoice revisions.
- Explicit validation and NextGen checks use a PostgreSQL queue with atomic multi-worker claiming, retry/backoff, restart recovery, idempotency, and dead-letter handling.
- Finance findings have controlled acknowledge/resolve/reopen UI actions and backend support for assignment and escalation.
- Audit rows include structured actor identity, role, metadata, and correlation IDs rather than relying only on note text.
