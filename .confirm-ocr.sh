#!/bin/bash
cd /opt/ap-invoice/apps/api
TOKEN=$(node -e "
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  { id: 'jc-user-id', email: 'jc@madison88.com', role: 'IT_ADMIN' },
  'madison88-jwt-secret-dev',
  { expiresIn: '2h' }
);
console.log(t);
" 2>/dev/null)

DBURL=$(grep DATABASE_URL /opt/ap-invoice/apps/api/.env | head -1 | sed 's/DATABASE_URL=//' | sed 's/"//g' | sed 's/?schema=.*//')

rm -f /tmp/confirmed-invoices.txt

echo "=== Creating invoices via confirm-OCR ==="
python3 << 'PYEOF'
import requests, json, os, uuid

token = os.environ.get("TOKEN", "")
# Read token from node output
import subprocess
token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Read uploaded job IDs
with open("/tmp/uploaded-invoices.txt") as f:
    jobs = [line.strip().split("|", 1) for line in f if line.strip()]

results = []
for job_id, filename in jobs:
    # Get job result
    resp = requests.get(
        f"http://localhost:3001/api/invoices/upload-jobs/{job_id}",
        headers=headers
    )
    job = resp.json()
    if job.get("status") != "completed":
        print(f"SKIP {filename} → {job.get('status')}")
        continue
    
    result = job.get("result", {})
    ext = result.get("extraction", {})
    vendor_match = result.get("vendor_match", {})
    storage_path = result.get("storage_path")
    
    # Clean up invoice_number (some have garbage concatenated)
    inv_num = ext.get("invoice_number") or ""
    # Fix Nilorn invoices that have concatenated data
    if "InvoiceDate" in inv_num:
        inv_num = inv_num.split("InvoiceDate")[0]
    if not inv_num or inv_num == "None":
        inv_num = f"UNKNOWN-{job_id[:8]}"
    
    # Build confirm-OCR payload
    payload = {
        "invoice_number": inv_num,
        "invoice_date": ext.get("invoice_date"),
        "due_date": ext.get("due_date"),
        "invoice_received_date": ext.get("invoice_received_date") or None,
        "vendor_id": vendor_match.get("vendor_id") if vendor_match else None,
        "vendor_name_raw": ext.get("vendor_name"),
        "total_amount": ext.get("amount") or ext.get("total_amount") or 0,
        "currency": ext.get("currency") or "USD",
        "payment_terms": ext.get("payment_terms"),
        "incoterm": ext.get("incoterm"),
        "subtotal": ext.get("subtotal"),
        "tax_amount": ext.get("tax_amount"),
        "discount_amount": ext.get("discount_amount"),
        "bank_charges": ext.get("bank_charge") or 0,
        "freight_charges": ext.get("freight_charges") or 0,
        "additional_charges": ext.get("additional_charges") or 0,
        "ship_to": ext.get("ship_to"),
        "sold_to": ext.get("sold_to"),
        "invoice_type": "INVOICE",
        "brand": ext.get("brand"),
        "brand_code": ext.get("brand_code"),
        "season": ext.get("season"),
        "mpo_number": ext.get("mpo_number"),
        "po_number": ext.get("po_number") or ext.get("po_reference_raw"),
        "bill_to_entity": "MADISON_88_LTD",
        "is_handwritten": ext.get("is_handwritten") or False,
        "line_items": ext.get("line_items") or [],
        "ocr_confidence_score": ext.get("ocr_confidence_score") or 0.5,
        "ocr_raw_data": ext,
        "bank_info": ext.get("bank_details"),
        "signatures": ext.get("signatures"),
        "storage_path": storage_path,
    }
    
    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}
    
    print(f"Confirming: {filename} (inv: {inv_num}, amount: {payload.get('total_amount')})")
    
    # Call confirm-OCR with a dummy ID
    dummy_id = str(uuid.uuid4())
    resp = requests.post(
        f"http://localhost:3001/api/invoices/{dummy_id}/confirm-ocr",
        headers=headers,
        json=payload
    )
    
    if resp.status_code in (200, 201):
        data = resp.json()
        inv_id = data.get("id") or data.get("invoice", {}).get("id")
        print(f"  ✓ Created invoice: {inv_id}")
        results.append((inv_id, filename))
        with open("/tmp/confirmed-invoices.txt", "a") as f:
            f.write(f"{inv_id}|{filename}\n")
    else:
        print(f"  ✗ Failed: {resp.status_code} - {resp.text[:200]}")

print(f"\n=== Total created: {len(results)} ===")
PYEOF
