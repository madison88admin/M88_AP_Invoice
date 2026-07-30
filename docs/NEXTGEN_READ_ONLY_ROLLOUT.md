# NextGen read-only rollout

The AP Invoice integration must only call NextGen login and read/list endpoints. Do not add create, update, delete, approve, or posting calls.

## Local secret handling

Store runtime secrets outside Git and inject them through environment variables or the deployment secret manager. The local diagnostic scripts now require:

- `M88_VPS_ROOT_PASSWORD` (legacy emergency diagnostics only)
- `M88_API_TOKEN`
- `M88_DEMO_PASSWORD`
- `M88_DATABASE_URL` or `M88_TUNNEL_DATABASE_URL`
- `M88_DATABASE_PASSWORD` / `M88_DATABASE_TEST_URLS`
- `M88_SUPABASE_ADMIN_PASSWORD`
- `M88_JWT_SECRET`

Never print these values. Existing credentials that previously appeared in scripts should be rotated.

## Restricted account

Create a dedicated NextGen integration identity with permission to view MPO headers and MPO lines only. It must not have permissions to edit, approve, post, create, or delete records. Configure `NEXTGEN_USERNAME` and `NEXTGEN_PASSWORD` from the staging/production secret store.

Server access should also use a non-root deployment/diagnostic identity with key-based SSH, no interactive password in scripts, and only the minimum commands required. Creating that server account is an infrastructure change and must be separately approved.

## Staging gate

1. Deploy the candidate build to staging only.
2. Select 3–5 real invoices covering single-line, multi-line, suffix-style MPO, currency, and an intentionally unmatched case.
3. Run a bounded read-only comparison.
4. Verify invoice and NextGen quantity, unit price, material code, MPO line number, line amount, currency, difference, and variance.
5. Confirm `FormLinesGridRead` retry and `MPOLIGridRead` fallback metrics.
6. Confirm incomplete pagination is rejected and never cached.
7. Confirm unavailable line data produces `NEXTGEN_UNAVAILABLE`, never a zero-value match.
8. Obtain production deployment approval.

No production deployment is permitted from this checklist alone.
