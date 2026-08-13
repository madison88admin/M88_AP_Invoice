"""Re-extract the 2 PT.VICTORIA invoices that didn't update."""
import requests, json, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

invoice_ids = [
    "42b73dab-5b6f-4848-991e-1f95dd34500a",  # SI26072048
    "40015ed9-41e3-454d-9ba3-c09014c14144",  # SI26072047
]

print(f"Re-extracting {len(invoice_ids)} invoices (AI-first priority fix)...")
payload = {"invoiceIds": invoice_ids, "reason": "Re-extract with AI-first priority over Madison regex"}

try:
    resp = requests.post("http://localhost:3001/api/reprocess/bulk-re-extract", headers=headers, json=payload, timeout=300)
    print(f"Status: {resp.status_code}")
    result = resp.json()
    print(f"Summary: {json.dumps(result.get('summary', {}))}")
    for r in result.get('results', []):
        print(f"  {r.get('invoice_number', r.get('invoice_id','?')[:8])}: {r.get('status')} — {r.get('message','')[:200]}")
except Exception as e:
    print(f"Error: {e}")
