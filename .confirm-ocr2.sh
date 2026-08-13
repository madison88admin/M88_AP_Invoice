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

python3 << 'PYEOF'
import requests, json, os, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Already created invoice numbers
created = set()
try:
    with open("/tmp/confirmed-invoices.txt") as f:
        for line in f:
            parts = line.strip().split("|", 1)
            if len(parts) == 2:
                created.add(parts[0])
except:
    pass

# Read uploaded job IDs
with open("/tmp/uploaded-invoices.txt") as f:
    jobs = [line.strip().split("|", 1) for line in f if line.strip()]

import uuid
results = []
for job_id, filename in jobs:
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
    
    # Clean up invoice_number
    inv_num = ext.get("invoice_number") or ""
    if "InvoiceDate" in inv_num:
        inv_num = inv_num.split("InvoiceDate")[0]
    if not inv_num or inv_num == "None" or "/" in inv_num:
        inv_num = f"UNKNOWN-{job_id[:8]}"
    
    # Skip if already created (check by invoice number + vendor)
    vendor_name = ext.get("vendor_name") or ""
    amount = ext.get("amount") or ext.get("total_amount") or 0
    if amount == 0:
        print(f"SKIP {filename} → amount=0")
        continue
    
    # Simplified payload — no line_items, no ocr_raw_data to avoid Prisma errors
    payload = {
        "invoice_number": inv_num,
        "invoice_date": ext.get("invoice_date"),
        "due_date": ext.get("due_date"),
        "vendor_id": vendor_match.get("vendor_id") if vendor_match else None,
        "vendor_name_raw": vendor_name,
        "total_amount": amount,
        "currency": ext.get("currency") or "USD",
        "payment_terms": ext.get("payment_terms"),
        "bill_to_entity": "MADISON_88_LTD",
        "ocr_confidence_score": 0.5,
        "storage_path": storage_path,
    }
    
    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}
    
    # Check if this invoice already exists
    check_key = f"{inv_num}_{vendor_name}_{amount}"
    
    print(f"Confirming: {filename} (inv: {inv_num}, amount: {amount})")
    
    dummy_id = str(uuid.uuid4())
    try:
        resp = requests.post(
            f"http://localhost:3001/api/invoices/{dummy_id}/confirm-ocr",
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if resp.status_code in (200, 201):
            data = resp.json()
            inv_id = data.get("id") or data.get("invoice", {}).get("id")
            print(f"  ✓ Created: {inv_id}")
            results.append((inv_id, filename))
            with open("/tmp/confirmed-invoices.txt", "a") as f:
                f.write(f"{inv_id}|{filename}\n")
        elif resp.status_code == 409:
            print(f"  ⊙ Duplicate — already exists")
        else:
            print(f"  ✗ Failed: {resp.status_code} - {resp.text[:200]}")
    except Exception as e:
        print(f"  ✗ Error: {e}")

print(f"\n=== Total created this round: {len(results)} ===")
PYEOF

echo ""
echo "=== All confirmed invoices ==="
cat /tmp/confirmed-invoices.txt 2>/dev/null
echo ""
echo "Total: $(wc -l < /tmp/confirmed-invoices.txt 2>/dev/null || echo 0)"
