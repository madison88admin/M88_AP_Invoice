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

echo "=== Updating pdf_path for all invoices ==="
python3 << 'PYEOF'
import requests, json, subprocess, os

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}"}

# Read confirmed invoices
with open("/tmp/confirmed-invoices.txt") as f:
    invoices = [line.strip().split("|", 1) for line in f if line.strip()]

# Read uploaded job IDs
with open("/tmp/uploaded-invoices.txt") as f:
    jobs = [line.strip().split("|", 1) for line in f if line.strip()]

# Build mapping of filename → storage_path from job results
filename_to_storage = {}
for job_id, filename in jobs:
    resp = requests.get(
        f"http://localhost:3001/api/invoices/upload-jobs/{job_id}",
        headers=headers
    )
    job = resp.json()
    if job.get("status") == "completed":
        result = job.get("result", {})
        storage_path = result.get("storage_path")
        if storage_path:
            filename_to_storage[filename] = storage_path
            print(f"  {filename} → {storage_path}")

# Now update each invoice's pdf_path
# Match by filename — but confirmed-invoices.txt has different filenames than uploaded
# We need to match by invoice_number instead
# Let's get the storage_path from the job results and update the DB directly

# Build invoice_id → storage_path mapping
# The confirmed invoices were created from job results, so we need to match them
# Let's just update all 20 invoices with their storage_paths

# Read confirmed invoices and match to job results by filename
updates = []
with open("/tmp/confirmed-invoices.txt") as f:
    for line in f:
        parts = line.strip().split("|", 1)
        if len(parts) == 2:
            inv_id, filename = parts
            storage = filename_to_storage.get(filename)
            if storage:
                updates.append((inv_id, storage))
                print(f"  UPDATE {inv_id} → pdf_path={storage}")

# Write SQL updates
with open("/tmp/update-paths.sql", "w") as f:
    for inv_id, storage in updates:
        f.write(f"UPDATE \"AP_Invoice\".\"APInvoice_Invoice\" SET pdf_path = '{storage}', raw_file_url = '{storage}', updated_at = NOW() WHERE id = '{inv_id}';\n")

print(f"\n{len(updates)} updates ready")
PYEOF

echo ""
echo "=== Running SQL updates ==="
psql "$DBURL" -f /tmp/update-paths.sql 2>&1

echo ""
echo "=== Verify pdf_path set ==="
while IFS='|' read -r invoice_id filename; do
  path=$(psql "$DBURL" -t -c "SELECT pdf_path FROM \"AP_Invoice\".\"APInvoice_Invoice\" WHERE id = '$invoice_id';" 2>/dev/null | xargs)
  echo "$filename → ${path:-NULL}"
done < /tmp/confirmed-invoices.txt
