# AP Invoice — Deploy & Rollback Runbook

**Last verified:** 2026-08-11 (by live inspection of the VPS `5.223.78.194` and repo config)
**Status:** API up (systemd), web on Netlify, DB on the same VPS. ⚠️ Known stability issues — see [Gotchas](#3-critical-gotchas-read-first).

---

## 1. Architecture — what runs where

### Frontend — Netlify (primary)
- SPA built from `apps/web` (`tsc && vite build` → `apps/web/dist`).
- Root `netlify.toml`: build command `corepack enable && pnpm install --no-frozen-lockfile && pnpm build --filter @ap-invoice/web`, publish `apps/web/dist`, Node 20.
- **API proxying:** Netlify *redirects* `/api/*` → `http://5.223.78.194/api/*` and `/api/invoices/upload*` (with `X-Netlify-Timeout: 300`). The redirects are simple HTTP redirects, so the browser calls the VPS directly — but long operations still risk Netlify's 10s proxy timeout for the *function* path.
- **Netlify Functions** (source in `netlify/functions/`): `proxy-api.ts` (forwards any `/api/...` to the VPS with a 290s timeout — used by the web's `post()` for QuickBooks posting) and `proxy-upload.ts` (uploads → `/api/invoices/upload-madison`, 540s timeout). These are **deployed manually from the local machine** (`netlify functions:deploy`) — the committed `netlify.toml` does **not** declare a functions directory, so CI does not deploy them.
- Netlify site ID: `9f6c66ca-1216-49c0-87d8-70cbf9e84f5a` (local `.netlify/state.json`). Linked repo: `madison88admin/M88_AP_Invoice` (the local `target` remote).

### Backend — VPS `5.223.78.194` (Ubuntu, shared Madison-88 server)
| Component | Mechanism | Details |
|---|---|---|
| **API** | systemd `ap-invoice-api.service` | `/opt/ap-invoice/apps/api`, `ExecStart=/usr/bin/pnpm start` → `node dist/index.js`, port **3001**. `EnvironmentFile=/opt/ap-invoice/apps/api/.env`, `Restart=on-failure`, `RestartSec=5`. Note: `NODE_ENV=development` is set in the unit. |
| **Web mirror** | nginx on port 80 | `/etc/nginx/sites-available/ap-invoice` serves `/opt/ap-invoice/apps/web/dist` for `/` and proxies `/api/` → `localhost:3001` (600s timeouts). Secondary access path (`http://5.223.78.194`). |
| **DB** | Supabase Postgres (docker) on the same VPS | Postgres on `5432` (direct, `DATABASE_URL` in `.env`) + `6543` (Supavisor pooler), Supabase REST/Kong on `8000`. Schema `AP_Invoice`. **Do not touch the docker stack.** |
| **RapidOCR** | systemd `rapidocr.service` | `/opt/ap-invoice/apps/ocr-service`, port 8500. |
| **Ollama** | systemd `ollama.service` | Port 11434, model `qwen3:14b`. |
| **SFTP intake** | in-process file watcher | `/incoming-invoices` (30s poll; subdirs `processing/`, `processed/`, `failed/`, `manual-review/`, `duplicates/`). |
| **Async state** | files on disk | `apps/api/data/async-jobs.json` (job store) + `apps/api/data/invoice-upload-queue/` (durable upload queue). These are **state — never delete/overwrite during deploys**. |

### Git topology
- VPS clone `/opt/ap-invoice` has a **single remote**: `origin = https://github.com/madison88admin/M88_AP_Invoice.git`.
- Local repo: `origin = mochines20/AP_Invoice` (personal), `target = madison88admin/M88_AP_Invoice` (deploy repo).
- **The deploy repo is `madison88admin/M88_AP_Invoice`.** Local HEAD and VPS HEAD were both `aff1cab` at last verification.

---

## 2. The flow in one picture

```
LOCAL (Windows)                          VPS 5.223.78.194                  NETLIFY
─────────────                           ──────────────────                ────────
edit → test → commit
push → target (madison88admin) ──► git pull origin main
                                     pnpm install / prisma generate
                                     pnpm build --filter @ap-invoice/api
                                     systemctl restart ap-invoice-api
pnpm build --filter @ap-invoice/web ──► (optional) rsync dist ─► nginx :80 serves dist
netlify deploy --prod (or CI on push)                              ◄── users hit this SPA
netlify functions:deploy (proxy-api, proxy-upload)                 ◄── /api/* redirected to VPS
```

---

## 3. Critical gotchas — read first

1. **Uncommitted working-tree changes are LIVE in production.**
   The VPS working tree (and the local tree) has uncommitted hotfixes that the running API depends on:
   - `apps/api/src/services/ocrService.ts` — RapidOCR-first pipeline (RapidOCR fast path ≥90% confidence, Groq-first AI fallback, 8k char truncation).
   - `apps/api/src/services/groqOCRService.ts` — `MAX_GROQ_TEXT_LENGTH` 30000 → 8000.
   A naive `git stash && git pull && build` **silently reverts these** and changes OCR behavior in prod. **Commit these two files first** (to `target`) before any clean deploy. Also note the VPS diff shows ~2500 changed lines for `ocrService.ts` (line-ending noise, CRLF vs LF) on top of the real ~370-line diff — set `git config core.autocrlf input` on the VPS to stop the false diffs.

2. **The VPS has 4 stashes of prior hotfixes** (`git -C /opt/ap-invoice stash list`), e.g. `pre-github-sync-20260810T033404Z`. Never rely on stashes; anything important must be committed. Do **not** use the old `ssh-restart.js` shortcut (it does `git stash` and even `rm -f apps/api/src/services/invoiceUploadQueue.ts` — destructive).

3. **The API crash-loops at startup.** ~81 `Main process exited` events in the last 24h; at 07:25 UTC today it failed 5× in ~25s (every 6s, `ELIFECYCLE status=1`) before recovering at 07:25:32. `Restart=on-failure` self-heals in ~10–15s, but deploys should expect the first restart to bounce. A runtime `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` from `express-rate-limit` has been seen in the journal (unhandled rejection can kill Node 20) — likely the crash source when requests come through nginx.

4. **`NODE_ENV=development` is set in the systemd unit** (not `production`). Side effects: the general/upload rate limiters `skip` in dev mode, and behavior differs from a production build. Flagged, not changed.

5. **SMTP is not configured** (`SMTP_HOST/USER/PASS` missing) — SLA reminder/escalation emails fail every hour (logged as errors). Non-fatal, but escalations silently never reach anyone.

6. **Shared VPS.** The box also runs bms-backend, po-cutting, smart-tp-costing, m88-trim-api (nginx :8100), and the Supabase docker stack (supavisor, Kong :8000). Never `systemctl restart nginx` globally, never restart/stop docker; use `nginx -s reload` only if the ap-invoice site config changed.

7. **Live logs:** `journalctl -u ap-invoice-api` is the real log. The `apps/api/error.log` / `combined.log` files on the VPS are stale copies (they contain Windows paths) — don't trust them.

8. **DB is on the same box** — a full VPS outage takes down the app *and* its database. Restoring the DB means restoring this server (or a Supabase backup), not just the app.

---

## 4. Deploy — API

### 4.1 Pre-flight (local machine)
```bash
# 1. Make sure the working tree is committed or deliberately uncommitted.
git status
# IMPORTANT: the two OCR hotfix files (ocrService.ts, groqOCRService.ts) must be
# committed to target BEFORE deploy, or they will be lost on a clean pull.

# 2. Build + tests locally first.
pnpm install
pnpm build --filter @ap-invoice/api
pnpm test --filter @ap-invoice/api        # if any

# 3. Migration-gap check — see §4.5. If this PR/session touched schema.prisma or
#    added a migrations/ folder entry, the DB MUST be migrated before the API
#    ships. Deploying API code that reads new columns/tables before `migrate
#    deploy` = instant 500s on every payment-batch endpoint.

# 4. Untracked-src check — `git status --short apps/api/src` MUST be empty
#    (or only deliberate scratch files). 2026-08-12 incident: six service files
#    (controllers/qb.ts, routes/qb.ts, qbExportService, reconciliationExportService,
#    rapidOCRService, upstageOCRService) were imported by index.ts/ocrService.ts but
#    never committed — local builds passed (files on disk) while the VPS build
#    failed with TS2307. Committed in f401df3. Best proof: build from a clean
#    checkout (`git stash -u && build && git stash pop`) before shipping.
```

### 4.2 Ship code
```bash
git add <changed files>
git commit -m "your change"
git push target main          # madison88admin/M88_AP_Invoice — THE deploy repo
```

### 4.3 On the VPS (read-only checks first)
```bash
ssh root@5.223.78.194   # credentials: see ssh-cmd.js / secret manager — do not add new copies

cd /opt/ap-invoice
git status --short                       # expect: any uncommitted files are intentional hotfixes
git stash list                           # know what is stashed before you pull
git fetch origin
git diff origin/main --stat              # confirm what the pull will bring

# ⚠️ NEVER `git stash push -u` on the VPS.
# `-u` removes untracked dirs (incl. dist.bak-* backups) from disk; dropping the
# stash deletes them for good (2026-08-12 incident — backups had to be recovered
# from the stash object via `git restore --source=<stash>^3`).
# Instead, move conflicting local files aside with plain `mv`.

# Record current build for rollback
cp -r apps/api/dist apps/api/dist.bak-$(date +%Y%m%d-%H%M%S)

# If working tree is clean (or after committing/stashing intentionally):
git pull origin main
```

### 4.4 Build & restart
```bash
pnpm install                            # if deps changed (pnpm-lock.yaml)
pnpm --filter @ap-invoice/api exec prisma generate   # if schema.prisma changed
pnpm build --filter @ap-invoice/api

systemctl restart ap-invoice-api
# Expect possible start bounce (known crash-loop) — wait, then verify:
sleep 15
systemctl status ap-invoice-api --no-pager | head -12
curl -s -o /dev/null -w "direct: HTTP %{http_code}\n" http://localhost:3001/api/health
curl -s -o /dev/null -w "via nginx: HTTP %{http_code}\n" http://localhost/api/health
curl -s http://localhost:3001/health/engines | head -c 600   # engine availability + queue stats
```

### 4.5 Database migration — the migration-gap checklist (READ FIRST)

> **Rule: never deploy API code that depends on a schema change until the DB migrations are applied.**
> The API selects the full Payment row (including `payment_date_source`, `bank_charge_amount`, `bank_charge_note`) and joins `APInvoice_BillStub`. If the columns/table don't exist, **every payment-batch endpoint 500s** with `column "..." does not exist`. Code and schema must move together — **migrate FIRST, then build & restart.**

**Checklist (run before every API deploy):**

```bash
# 1. Does the DB match the repo? (run from apps/api so DATABASE_URL/.env load)
cd /opt/ap-invoice/apps/api
npx prisma migrate status --schema ../../packages/db/prisma/schema.prisma
#    → "No pending migrations" = OK.
#    → "have not yet been applied: ..." = STOP. Deploying now breaks the API.
```

If migrations are pending:

```bash
# 2. Backup first — DB is Supabase Postgres on this box (docker). Use supabase/pg_dump:
pg_dump "$(grep DATABASE_URL apps/api/.env | cut -d= -f2-)" -Fc -f /root/ap-invoice-backup-$(date +%Y%m%d).dump

# 3. Apply — prod-safe command (NEVER migrate dev / db push --force-reset):
cd /opt/ap-invoice && pnpm db:migrate    # runs prisma migrate deploy
```

**Drift recovery** — if `migrate deploy` fails with `P3018` / `column already exists` (the DDL was applied manually or via `db push` earlier, without recording it in `_prisma_migrations`):

```bash
# 4. Confirm the existing column/table matches the migration's definition (read-only):
#    e.g. information_schema.columns → data_type, is_nullable
# 5. Mark it applied WITHOUT running SQL (only writes a _prisma_migrations row):
npx prisma migrate resolve --applied <migration-name> --schema ../../packages/db/prisma/schema.prisma
# 6. Re-run migrate deploy for the rest, then re-verify:
npx prisma migrate deploy --schema ../../packages/db/prisma/schema.prisma
npx prisma migrate status --schema ../../packages/db/prisma/schema.prisma   # → all applied
```

**Post-migration verify** — the API must actually *work*, not just start:
```bash
curl -s http://localhost:3001/api/health
curl -s "http://localhost:3001/api/payment-batches/scheduled-payments"   # touches the new columns
```

> **Real incident (2026-08-11):** the live DB was found **4 migrations behind** the repo — its history stopped at `20260718123000_extraction_market_upgrade`, missing `20260806080000_add_size_to_invoice_line` (drift: column existed but unrecorded), `20260811000000_add_payment_date_source`, `20260811010000_add_bank_charge_to_payment`, and `20260811020000_add_bill_stub`. The payment-batch smoke test 500'd on `APInvoice_Payment.payment_date_source does not exist`. Resolved with steps 4–6 (resolve --applied for the drifted column, then deploy); all 13 migrations are now applied. The bank-charge smoke test (`apps/api/smoke-bank-charge.js`) now passes **12/12 end-to-end** — it creates a throwaway DRAFT batch from a real scheduled payment, verifies apply → total UP (59.67 → 64.67) → remove → total restored (59.67), then cancels the batch (payments return to the schedule; only audit entries remain). This is exactly what the checklist above prevents.

---

## 5. Deploy — Web

### 5.1 Build locally
```bash
pnpm build --filter @ap-invoice/web      # tsc && vite build → apps/web/dist
```

### 5.2 Push to Netlify
Option A — CI (recommended): push to `madison88admin/M88_AP_Invoice`; Netlify auto-builds from the root `netlify.toml`.
Option B — CLI from local machine:
```bash
netlify deploy --prod --dir apps/web/dist
```

### 5.3 Deploy the Netlify Functions (manual — required whenever netlify/functions changes)
```bash
netlify functions:deploy   # deploys netlify/functions/proxy-api.ts + proxy-upload.ts
# Verify both exist:
netlify functions:list
```
> The committed `netlify.toml` has no `[functions]` section, so CI will **not** deploy functions. If the site is ever rebuilt from a fresh repo, the functions must be re-deployed manually or the config updated to include `[functions] directory = "netlify/functions"`.

### 5.4 VPS web mirror (optional secondary path)
```bash
# Either build on the VPS:
cd /opt/ap-invoice && pnpm build --filter @ap-invoice/web
# Or rsync from local:
rsync -av apps/web/dist/ root@5.223.78.194:/opt/ap-invoice/apps/web/dist/
```
nginx picks it up automatically (no reload needed for static files).

### 5.5 Verify
- Load the Netlify URL and log in.
- `https://<netlify-site>/api/health` → 200 (redirect to VPS).
- Do one real end-to-end: upload a PDF (function path), confirm, post.
- `curl -s https://<netlify-site>/.netlify/functions/proxy-api/health` → 200.

---

## 6. Rollback

### API (fastest, safest)
The `apps/api/dist.bak-*` you made before deploying is the previous good build:
```bash
cd /opt/ap-invoice/apps/api
systemctl stop ap-invoice-api
rm -rf dist && mv dist.bak-<timestamp> dist
systemctl start ap-invoice-api
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/api/health
```
If you did not make a backup, checkout the previous commit instead:
```bash
cd /opt/ap-invoice
git checkout <previous-commit> -- apps/api
pnpm build --filter @ap-invoice/api
systemctl restart ap-invoice-api
```
(Then investigate the regression; do not leave the tree on a detached checkout — commit or restore.)

### Web
- Netlify: Dashboard → Deploys → pick the last good deploy → **Publish deploy** (instant). Or locally: `netlify deploy --prod --dir <previous-dist>`.
- VPS mirror: restore the previous `apps/web/dist` backup (make one before each web deploy), or re-run the previous build.

### Database
- Normal deploys shouldn't migrate the DB. If you ran `prisma migrate deploy` and need to undo: restore the `pg_dump` backup from step 4.5 (this is a full-database restore — coordinate downtime). **Never** run a destructive `prisma migrate reset`/`db push --force-reset` in production.

### After any rollback
1. Confirm `/api/health` and `/health/engines` are green.
2. Check `journalctl -u ap-invoice-api --since "5 min ago"` for errors.
3. Confirm the SFTP watcher is still draining `/incoming-invoices` (no growth in `processing/`).
4. Verify a test upload + confirm works through the Netlify URL.

---

## 7. Health check cheat sheet

```bash
# On the VPS
systemctl status ap-invoice-api rapidocr ollama nginx --no-pager | grep -E "Active|●"
curl -s http://localhost:3001/api/health
curl -s http://localhost:3001/health/engines
curl -s http://localhost:8500/health          # RapidOCR
curl -s http://localhost:11434/api/tags      # Ollama
journalctl -u ap-invoice-api --since "10 min ago" --no-pager | grep -iE "error|fail|crash" | tail
pg_isready -h localhost -p 5432
ls /incoming-invoices | wc -l                # queue depth; watch processing/ for stalls

# From local machine
curl -s https://<netlify-site>/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://<netlify-site>/.netlify/functions/proxy-api/health
```

---

## 8. Access & secrets

| Secret | Where |
|---|---|
| VPS SSH (`root@5.223.78.194`) | Hardcoded in repo-root scripts (`ssh-cmd.js`, `ssh-deploy2.js`…) — **rotate to SSH keys / a secret manager**; stop committing more copies |
| API env (`DATABASE_URL`, JWT, Gemini/Groq/Ollama keys, Supabase, Hetzner S3, NextGen) | `/opt/ap-invoice/apps/api/.env` (loaded via `EnvironmentFile`). Never commit. |
| Web env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`) | Netlify dashboard → Site settings → Environment variables. Never commit. |
| Netlify site | Site ID `9f6c66ca-1216-49c0-87d8-70cbf9e84f5a`; deploy repo `madison88admin/M88_AP_Invoice` |

---

## 9. Known issues to fix soon

- [ ] Commit the RapidOCR/Groq hotfixes (`ocrService.ts`, `groqOCRService.ts`) to `target`.
- [ ] Stop the startup crash-loop (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` / unhandled rejection in `express-rate-limit`; possible `EADDRINUSE` during restarts).
- [ ] Set `NODE_ENV=production` in the systemd unit and re-test rate limiting behind nginx.
- [ ] Configure SMTP so SLA reminders/escalations actually send.
- [ ] Move VPS root-password access to SSH keys; centralize secrets.
- [ ] Standardize on one web host (Netlify vs VPS nginx) — both currently serve the SPA.
- [ ] Fix CRLF/LF noise on the VPS (`core.autocrlf input`) to keep diffs readable.
- [ ] Bake the §4.5 migration-gap check into the deploy flow (run `prisma migrate status` before every ship) — the live DB was 4 migrations behind on 2026-08-11 and blocked all payment-batch endpoints until resolved.
