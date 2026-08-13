"""
Bulk re-extract 9 VALIDATION_PENDING invoices via API.
Uses the new Ollama Qwen2.5:3b-instruct flow.
"""
import requests, json, subprocess, time, sys

# Get JWT token
token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
}

invoice_ids = [
    "8ae0f6a5-4e38-47d4-ac17-06935e65d4e8",  # SIN887186 - BRAND ID
    "2df6fd8a-8e2e-453c-a965-741a9b0e453e",  # SI26072050 - PT.VICTORIA LABEL
    "42b73dab-5b6f-4848-991e-1f95dd34500a",  # SI26072048 - PT.VICTORIA LABEL
    "40015ed9-41e3-454d-9ba3-c09014c14144",  # SI26072047 - PT.VICTORIA LABEL
    "25c686c7-ef3c-498e-a868-daf26c075463",  # 8266895405 - NILORN
    "4eb71b02-66dc-4595-9445-eab4e8165e59",  # SO20261266 - DongGuang
    "fda34d4d-e061-478d-8642-2b7b6ab3d83d",  # 100750840 - Avery Dennison
    "a61a7b8b-98f4-4de9-b3f8-329e8e9d1885",  # 100749789 - Avery Dennison
    "637253ea-faec-435e-9345-b05773360c79",  # 100746823 - Avery Dennison
]

print(f"Re-extracting {len(invoice_ids)} invoices with new Ollama flow...")
print("=" * 70)

# Use bulk re-extract endpoint
payload = {
    "invoiceIds": invoice_ids,
    "reason": "Re-extract with new Ollama Qwen2.5:3b-instruct flow for better accuracy",
}

try:
    resp = requests.post(
        "http://localhost:3001/api/reprocess/bulk-re-extract",
        headers=headers,
        json=payload,
        timeout=600,  # 10 min timeout — 9 invoices × ~30s each + overhead
    )
    print(f"Status: {resp.status_code}")
    result = resp.json()
    print(json.dumps(result, indent=2, default=str)[:3000])
except requests.exceptions.Timeout:
    print("Request timed out — check logs for progress")
except Exception as e:
    print(f"Error: {e}")
