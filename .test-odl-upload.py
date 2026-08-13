import requests, json, subprocess, os

# Generate JWT token
token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}"}

# Upload a test PDF
test_file = "/tmp/bulk-upload/CHECKPOINT- IA00493973.pdf"
print(f"Uploading: {test_file}")

with open(test_file, "rb") as f:
    resp = requests.post(
        "http://localhost:3001/api/invoices/upload-madison-async",
        headers=headers,
        files={"file": ("CHECKPOINT- IA00493973.pdf", f)}
    )

print(f"Upload status: {resp.status_code}")
job_id = resp.json().get("jobId")
print(f"Job ID: {job_id}")

# Poll for completion
import time
for i in range(60):
    time.sleep(3)
    resp = requests.get(
        f"http://localhost:3001/api/invoices/upload-jobs/{job_id}",
        headers=headers
    )
    job = resp.json()
    status = job.get("status")
    print(f"  [{i*3}s] Status: {status}")
    if status == "completed":
        result = job.get("result", {})
        ext = result.get("extraction", {})
        print(f"\n=== EXTRACTION RESULT ===")
        print(f"  vendor: {ext.get('vendor_name')}")
        print(f"  invoice_number: {ext.get('invoice_number')}")
        print(f"  invoice_date: {ext.get('invoice_date')}")
        print(f"  amount: {ext.get('amount')}")
        print(f"  currency: {ext.get('currency')}")
        print(f"  po_number: {ext.get('po_number')}")
        print(f"  mpo_number: {ext.get('mpo_number')}")
        print(f"  bank: {ext.get('bank_details', {}).get('bank_name', 'N/A')}")
        print(f"  swift: {ext.get('bank_details', {}).get('swift_code', 'N/A')}")
        break
    elif status == "failed":
        print(f"  FAILED: {job.get('error')}")
        break
