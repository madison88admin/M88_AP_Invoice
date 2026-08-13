#!/bin/bash
# Test Ollama with simplified prompt — measure response time
echo "=== Ollama extraction test with simplified prompt ==="

# Get a sample invoice text from the DB
DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

# Get raw text from a recent invoice
RAW_TEXT=$(psql "$DBURL" -t -A -c "SELECT (ocr_raw_data->>'raw_text')::text FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE ocr_raw_data->>'raw_text' IS NOT NULL ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | head -c 3000)

if [ -z "$RAW_TEXT" ]; then
  echo "No raw text found in DB, using sample text"
  RAW_TEXT="INVOICE SI26072271 To: MADISON 88.,LTD 2433 Curtis Street, 2 Floor, Denver CO 80205, Date: 24 Jul 2026 VNS_FH27_SMS_MPO0015845_STYLE# VN000QB2 Po No.: SO26071144 Amount: 157.09 IDR"
fi

echo "Text length: ${#RAW_TEXT} chars"
echo "First 200 chars: ${RAW_TEXT:0:200}"
echo ""

# Test via the API's Ollama service directly
START=$(date +%s%N)
RESULT=$(curl -s http://localhost:11434/api/chat -d "{
  \"model\": \"qwen2.5:3b-instruct\",
  \"messages\": [
    {\"role\": \"system\", \"content\": \"You are an invoice data extractor. Return ONLY valid JSON, no explanation.\"},
    {\"role\": \"user\", \"content\": \"Extract invoice fields from the text below. Return ONLY valid JSON.\\nvendor_name = supplier company (NOT Madison 88), invoice_number, invoice_date (YYYY-MM-DD), due_date (YYYY-MM-DD), payment_terms, total_amount (number), currency (USD/HKD/etc), po_number (e.g. PO3011), mpo_number (e.g. MPO015713), brand, brand_code, season, qty_shipped, document_type, bank_name, swift_code, account_number, subtotal, bank_charges, freight_charges, additional_charges, discount_amount, tax_amount, line_items [{description, quantity, unit_price, total_amount, item_code, size}].\\nIf a field is missing, use null. Return ONLY the JSON object.\\n\\nExtract invoice fields from this text. Return ONLY valid JSON:\\n$RAW_TEXT\"}
  ],
  \"stream\": false,
  \"think\": false,
  \"options\": {\"temperature\": 0.1, \"num_ctx\": 8192, \"num_predict\": 2048}
}" 2>&1)
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))

echo "Response time: ${ELAPSED}ms"
echo "Response:"
echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',{}).get('content','?')[:500])" 2>/dev/null || echo "$RESULT" | head -c 500

echo ""
echo ""
echo "=== Check startup logs ==="
journalctl -u ap-invoice-api --since '1 min ago' --no-pager -o cat 2>&1 | grep -iE 'Ollama|File Watcher|recover' | grep -v 'stack\|node_modules\|at async\|rawLine' | tail -10
