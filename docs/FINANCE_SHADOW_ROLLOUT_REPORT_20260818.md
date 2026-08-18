# Finance Shadow Rollout Report — 2026-08-18

## Environment

- Production API: healthy on port 3001; unchanged at 15 migrations.
- Shadow API: active on port 3101 from `/opt/ap-invoice-staging-20260818T023641Z`.
- Shadow database: `ap_invoice_staging_20260818T023641Z`; 19 migrations applied.
- Side effects disabled: no SharePoint watcher, SFTP/file watcher, OCR model preload, or SLA reminders.
- GitHub: no push performed. Production API/database: no code or schema promotion performed.

## Backup and restore evidence

- Encrypted backup: `/root/ap-invoice-backups/20260818T023641Z/ap_invoice_production.dump.enc`
- SHA-256: `b11cfa7a47ec9f1bee1c216e19934b7799e2e310a0251df46d41860236356bcd`
- Restore comparison: 20 production tables = 20 staging tables; 252 production invoices = 252 staging invoices.

## Database-backed UAT

- Result: PASS.
- Required-field backend gate: PASS.
- Two-MPO subtotal calculation: PASS (`MPO001` 20.00; `MPO002` 15.00).
- New cumulative/NextGen columns present: PASS.
- Real NextGen read-only authentication: PASS.
- Historical MPO `MPO015967`: found with 2 lines after bounded pagination fallback.
- Deterministic anomaly scan: completed with 19 actionable findings.
- Four-way reconciliation: completed with 6 actionable findings.
- Shadow API health: PASS.

## Promotion gate

Production promotion is intentionally blocked pending human Finance review of the 19 anomaly findings and 6 reconciliation findings. These findings may represent real exceptions or expected historical-data gaps; code must not auto-accuse or auto-modify them.

Required approvals before production:

1. Accounting validates each critical/high finding.
2. Purchasing validates multi-MPO and cumulative quantities against selected invoices.
3. IT reviews the three migrations and the rollback evidence.
4. Finance signs the tolerance policy and shadow comparison.
5. A separate explicit production-promotion approval is issued.

## Durable evidence tranche

- Staging-only migration `20260818140000_durable_finance_evidence` applied successfully.
- Immutable validation snapshots now retain request/response SHA-256 fingerprints, invoice revision, source version, vendor identifiers, and supersession history.
- Validation and NextGen endpoint jobs now use PostgreSQL atomic claiming (`FOR UPDATE SKIP LOCKED`), exponential retry, restart lease recovery, idempotency keys, and dead-letter state.
- Audit records have dedicated actor name, role, structured metadata, and correlation ID fields.
- Findings support assignment, acknowledgement, resolution, reopen, and escalation lifecycle fields; dashboard actions cover acknowledge, resolve, and reopen.
- Local regression: 35 test files and 265 tests passed. Local and VPS API/web builds passed.
- Repeated database-backed UAT passed with 252 restored invoices. Read-only NextGen `MPO015967` lookup returned two lines after pagination fallback.
- Staging and production health endpoints remained healthy after restarting only the staging service.
- Browser smoke over a temporary localhost-only SSH tunnel reached the staging service with no console error, but the isolated service exposes the API only (`Cannot GET /`); full interactive UI UAT remains part of the later Finance UAT/promotion gate. The tunnel was closed immediately and no firewall rule was changed.
