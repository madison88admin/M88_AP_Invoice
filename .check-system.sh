#!/bin/bash
echo "=== API Service ==="
systemctl is-active ap-invoice-api
echo ""
echo "=== Uptime ==="
systemctl show ap-invoice-api --property=ActiveEnterTimestamp
echo ""
echo "=== API Health Check ==="
curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:3001/health 2>/dev/null || echo "No /health endpoint"
echo ""
echo ""
echo "=== File Watcher (last startup) ==="
journalctl -u ap-invoice-api --since "10 min ago" --no-pager -o cat 2>&1 | grep -iE "File Watcher.*Starting|File Watcher.*Incoming|File Watcher.*poll" | tail -3
echo ""
echo "=== Ollama ==="
curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
models = d.get('models', [])
print(f'Ollama running — {len(models)} models: {", ".join(m[\"name\"] for m in models)}')
" 2>/dev/null || echo "Ollama NOT running"
echo ""
echo "=== Incoming folder ==="
COUNT=$(ls /incoming-invoices/*.pdf 2>/dev/null | wc -l)
echo "$COUNT PDFs waiting"
echo ""
echo "=== Processing folder ==="
COUNT=$(ls /incoming-invoices/processing/*.pdf 2>/dev/null | wc -l)
echo "$COUNT PDFs in processing"
echo ""
echo "=== Recent extraction logs (last 10 min) ==="
journalctl -u ap-invoice-api --since "10 min ago" --no-pager -o cat 2>&1 | grep -iE "File Watcher.*Found|File Watcher.*Processing|File Watcher.*Saved|OCR.*succeed|Ollama.*extracted" | tail -5
echo ""
echo "=== Memory ==="
free -h | head -2
