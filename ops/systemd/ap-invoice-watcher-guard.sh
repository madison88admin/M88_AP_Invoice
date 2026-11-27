#!/usr/bin/env bash
set -euo pipefail

PROCESSING_DIR="${AP_INVOICE_PROCESSING_DIR:-/incoming-invoices/processing}"
STATE_FILE="/var/lib/ap-invoice/watcher-guard.last-restart"
STALE_SECONDS="${AP_INVOICE_WATCHER_STALE_SECONDS:-900}"
COOLDOWN_SECONDS="${AP_INVOICE_WATCHER_GUARD_COOLDOWN_SECONDS:-600}"

mkdir -p "$(dirname "$STATE_FILE")"
now=$(date +%s)
stale_file=""
stale_age=0

if [[ -d "$PROCESSING_DIR" ]]; then
  while IFS= read -r -d '' file; do
    [[ -f "$file" ]] || continue
    ctime=$(stat -c '%Z' "$file" 2>/dev/null || echo "$now")
    age=$((now - ctime))
    if (( age > stale_age )); then
      stale_age=$age
      stale_file="$file"
    fi
  done < <(find "$PROCESSING_DIR" -maxdepth 1 -type f \( -iname '*.pdf' -o -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) -print0 2>/dev/null)
fi

if [[ -z "$stale_file" || "$stale_age" -lt "$STALE_SECONDS" ]]; then
  exit 0
fi

if [[ -f "$STATE_FILE" ]]; then
  last_restart=$(stat -c '%Y' "$STATE_FILE" 2>/dev/null || echo 0)
  if (( now - last_restart < COOLDOWN_SECONDS )); then
    logger -t ap-invoice-watcher-guard "stale processing file detected but restart cooldown is active: $stale_file age=${stale_age}s"
    exit 0
  fi
fi

logger -t ap-invoice-watcher-guard "restarting ap-invoice-api; processing file stale for ${stale_age}s: $stale_file"
systemctl restart ap-invoice-api
touch "$STATE_FILE"
