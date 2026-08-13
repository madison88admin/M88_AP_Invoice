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

echo "=== Uploading 4 remaining files with special chars ==="

# Use python to handle special characters properly
python3 << 'PYEOF'
import requests
import json
import os

token = os.popen("node -e \"const jwt=require('jsonwebtoken');console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))\" 2>/dev/null").read().strip()

files_to_upload = [
    "/tmp/bulk-upload/07232026 Checkpoint Systems Limited  $3,156.97 - PAYMENT.pdf",
    "/tmp/bulk-upload/07232026 Checkpoint Systems Limited  $3,156.97.pdf",
    "/tmp/bulk-upload/07302026 Nilorn East  Asia  Ltd. $1,464.95 - PAYMENT.pdf",
    "/tmp/bulk-upload/07302026 Nilorn East  Asia  Ltd. $1,464.95.pdf",
]

headers = {"Authorization": f"Bearer {token}"}
url = "http://localhost:3001/api/invoices/upload-madison-async"

for filepath in files_to_upload:
    if not os.path.exists(filepath):
        print(f"NOT FOUND: {filepath}")
        continue
    filename = os.path.basename(filepath)
    print(f"Uploading: {filename}")
    with open(filepath, "rb") as f:
        resp = requests.post(url, headers=headers, files={"file": (filename, f)})
    print(f"  Status: {resp.status_code}")
    try:
        data = resp.json()
        inv_id = data.get("invoice_id", "") or data.get("id", "") or data.get("jobId", "")
        print(f"  ID: {inv_id}")
        if inv_id:
            with open("/tmp/uploaded-invoices.txt", "a") as out:
                out.write(f"{inv_id}|{filename}\n")
    except:
        print(f"  Response: {resp.text[:200]}")
PYEOF

echo ""
echo "=== All uploaded files ==="
cat /tmp/uploaded-invoices.txt 2>/dev/null
echo ""
echo "Total: $(wc -l < /tmp/uploaded-invoices.txt 2>/dev/null || echo 0) files"
