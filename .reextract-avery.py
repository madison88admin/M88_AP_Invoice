"""Re-extract 100746823 (Avery Dennison) — should now download from Supabase via raw_file_url."""
import requests, json, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# 100746823 has raw_file_url = invoices/2026/08/1785830709268_Avery__INV_100746823.pdf
invoice_ids = ["637253ea-faec-435e-9345-b05773360c79"]

print("Re-extracting 100746823 (Avery Dennison) via raw_file_url Supabase download...")
payload = {"invoiceIds": invoice_ids, "reason": "Re-extract with fixed raw_file_url Supabase download"}

try:
    resp = requests.post("http://localhost:3001/api/reprocess/bulk-re-extract", headers=headers, json=payload, timeout=300)
    print(f"Status: {resp.status_code}")
    result = resp.json()
    print(f"Summary: {json.dumps(result.get('summary', {}))}")
    for r in result.get('results', []):
        print(f"  {r.get('invoice_number', r.get('invoice_id','?')[:8])}: {r.get('status')} — {r.get('message','')[:300]}")
except Exception as e:
    print(f"Error: {e}")
