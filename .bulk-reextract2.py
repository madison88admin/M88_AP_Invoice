"""
Re-extract the invoices that failed due to the invoice_type enum bug.
Skip SIN887186 (no pdf_path) and Avery Dennison (stale local paths).
"""
import requests, json, subprocess, time

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}

# Only the 3 PT.VICTORIA invoices that failed due to enum bug
# Plus SO20261266 and NILORN which may have partially succeeded
invoice_ids = [
    "2df6fd8a-8e2e-453c-a965-741a9b0e453e",  # SI26072050 - PT.VICTORIA
    "42b73dab-5b6f-4848-991e-1f95dd34500a",  # SI26072048 - PT.VICTORIA
    "40015ed9-41e3-454d-9ba3-c09014c14144",  # SI26072047 - PT.VICTORIA
    "25c686c7-ef3c-498e-a868-daf26c075463",  # 8266895405 - NILORN
    "4eb71b02-66dc-4595-9445-eab4e8165e59",  # SO20261266 - DongGuang
]

print(f"Re-extracting {len(invoice_ids)} invoices (enum bug fixed)...")
print("=" * 70)

payload = {
    "invoiceIds": invoice_ids,
    "reason": "Re-extract with fixed invoice_type enum mapping",
}

try:
    resp = requests.post(
        "http://localhost:3001/api/reprocess/bulk-re-extract",
        headers=headers,
        json=payload,
        timeout=600,
    )
    print(f"Status: {resp.status_code}")
    result = resp.json()
    # Print summary and each result
    print(f"\nSummary: {json.dumps(result.get('summary', {}))}")
    for r in result.get('results', []):
        status = r.get('status')
        msg = r.get('message', '')[:200]
        inv = r.get('invoice_number', r.get('invoice_id', '?')[:8])
        print(f"  {inv}: {status} — {msg}")
except Exception as e:
    print(f"Error: {e}")
