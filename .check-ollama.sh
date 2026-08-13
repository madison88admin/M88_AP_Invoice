#!/bin/bash
echo "=== Ollama simple test ==="
START=$(date +%s%N)
RESULT=$(curl -s http://localhost:11434/api/generate -d '{"model":"qwen2.5:3b-instruct","prompt":"What is 2+2? Answer with just the number.","stream":false}' 2>&1)
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
echo "Response time: ${ELAPSED}ms"
echo "Response: $(echo $RESULT | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("response","?")[:100])' 2>/dev/null || echo $RESULT | head -c 200)"

echo ""
echo "=== Ollama invoice extraction test ==="
START=$(date +%s%N)
RESULT=$(curl -s http://localhost:11434/api/generate -d '{"model":"qwen2.5:3b-instruct","prompt":"Extract the vendor name, invoice number, total amount, currency, and invoice date from this invoice text:\n\nINVOICE SI26072271\nTo: MADISON 88.,LTD\nDate: 24 Jul 2026\nAmount: 157.09 IDR\n\nRespond in JSON format.","stream":false}' 2>&1)
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
echo "Response time: ${ELAPSED}ms"
echo "Response: $(echo $RESULT | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("response","?")[:300])' 2>/dev/null || echo $RESULT | head -c 300)"

echo ""
echo "=== Check Ollama timeout in ollamaOCRService ==="
grep -n 'timeout\|Timeout\|TIMEOUT\|abort\|Abort\|signal' /opt/ap-invoice/apps/api/src/services/ollamaOCRService.ts | head -15

echo ""
echo "=== Recent Ollama timeout errors ==="
journalctl -u ap-invoice-api --since '1 hour ago' --no-pager -o cat 2>&1 | grep -iE 'Ollama.*timeout|Ollama.*abort|Ollama.*failed|extractFromText failed' | tail -10
