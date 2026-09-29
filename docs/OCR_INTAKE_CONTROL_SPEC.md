# AP Invoice intake control specification

This document is the release contract for invoice intake. A PDF is never
created as an invoice record until the controls below pass.

## State flow

`RECEIVED -> ATTACHMENT_DETECTED -> UPLOADED -> EXTRACTED -> CREATED`

Any failed validation goes to `REVIEW_REQUIRED`. OCR/provider failures are
retried up to the configured cap, then go to the dead-letter/retry queue. Only
the `CREATED` state may create an invoice row. A retry must be idempotent and
must not create a second row.

## Blocking controls

| Requirement | Implementation | Automated evidence |
| --- | --- | --- |
| Invoice-only classification | `intakeReviewReason` and filename/body suppression route packing lists, AWB, delivery notes and other shipment documents to review | `fileWatcherService.intakeReviewReason.test.ts` |
| Required fields and positive amount | intake review gate rejects missing vendor, invoice number, date or amount | `fileWatcherService.intakeReviewReason.test.ts` |
| Ambiguous dates/amounts | `normalizeDate` refuses ambiguous numeric dates; `normalizeAmount` refuses ambiguous grouped numbers | `intakeControlService.test.ts` |
| Page/attachment coverage | input and processed page counts are logged; missing referenced attachments or incomplete coverage route to review | `intakeControlService.test.ts` |
| Reconciliation | line/subtotal plus explicit charges less discount is compared with configured currency tolerance; unread terms are `null`, not zero | `intakeControlService.test.ts` |
| Duplicate protection | file hash and business-key checks run before creation; same vendor + invoice number with changed amount/date is a review case | `intakeControlService.test.ts`, `duplicateDetectionService` classifier |
| Engine disagreement | normalized invoice number, amount, date, SWIFT and account values are compared; disagreement is evidence for review | `intakeControlService.test.ts` |
| Bank control | invoice bank fields are evidence only; payment uses Vendor Master and mismatches remain review/fraud evidence | vendor matching and payment controls |
| Failure isolation | OCR retries are bounded and intake monitoring records retry/failure events without blocking the backend | `intakeRetryService.test.ts` |

## Configuration and rollout gates

- Default reconciliation tolerance is USD/EUR `0.01` and IDR `1`; overrides
  use `INTAKE_RECONCILIATION_TOLERANCES` and require change approval.
- Benchmark gate: 30 varied invoices, including scanned documents, multi-page
  invoices, SIC/PT Super Dry cases, multi-currency documents and adversarial
  near-duplicates. Amount and bank-detail false accepts must be zero in the
  gate sample; this is a minimum gate, not a statistical guarantee.
- Shadow mode: 14 days or 100 invoices, whichever is later, with per-field
  comparison evidence. Any amount or bank false accept disables the feature
  flag and returns intake to the existing review path.
- OCR worker limits, model versions and licenses must be pinned in the release
  manifest before production rollout.

Raw OCR output and page evidence contain vendor/payment data. Access is
restricted to AP/Finance and IT administrators, transport/storage encryption is
required, and retention follows the company AP/audit retention policy.
