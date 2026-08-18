# Controlled Migration, Backup, Shadow Rollout, and Rollback

## Before deployment

- [ ] Record Git commit, API artifact digest, frontend artifact digest, Prisma migration list, and current environment version.
- [ ] Put deployment window and named Finance/IT approvers in the change ticket.
- [ ] Run full tests and builds from a clean checkout.
- [ ] Export schema-only backup and encrypted full PostgreSQL backup to approved backup storage.
- [ ] Record backup file checksum, timestamp, database server, retention, and operator.
- [ ] Restore the backup into an isolated database and run smoke queries. A backup is not confirmed until restore succeeds.
- [ ] Confirm no secrets or complete bank accounts appear in logs/artifacts.

## Deployment

1. Stop new ingestion; let active jobs complete or remain durable in queue.
2. Apply reviewed Prisma migrations using the production migration command.
3. Deploy API with `FINANCE_CONTROLS_SHADOW_MODE=true`.
4. Deploy compatible frontend; legacy `passed` remains available during shadow comparison.
5. Run health, authentication, upload, validation, returned workflow, Accounting, payment, and reconciliation smoke tests.
6. Compare old/new results on anonymized and approved production samples.
7. Finance signs off false positives, tolerances, multi-MPO totals, and dashboard findings.
8. Enable warnings, then hard blocks only through a second reviewed change.

## Rollback

1. Disable ingestion and scheduled Finance controls.
2. Restore the previous API/frontend artifacts.
3. Prefer forward-fix migrations. If schema rollback is required, restore the verified database backup into an isolated target and switch only after reconciliation.
4. Replay durable queued jobs only after version compatibility is confirmed.
5. Reconcile invoices/payments created during the deployment window.
6. Record rollback reason, affected invoice IDs, timestamps, operators, and Finance sign-off.

## Backup confirmation record

Status: **VERIFIED 2026-08-18 UTC — schema-scoped production backup restored successfully into an isolated staging database. Production was not migrated.**

| Evidence | Value |
|---|---|
| Backup timestamp | 2026-08-18 02:36:41 UTC |
| Backup archive | `/root/ap-invoice-backups/20260818T023641Z/ap_invoice_production.dump.enc` (mode 0600; AES-256-CBC/PBKDF2) |
| Backup checksum | `b11cfa7a47ec9f1bee1c216e19934b7799e2e310a0251df46d41860236356bcd` |
| Restore-test database | `ap_invoice_staging_20260818T023641Z` |
| Restore test result | PASS: 20/20 AP tables; 252/252 invoices |
| Operator/reviewer | Codex execution; Finance/IT human review still required before production promotion |
