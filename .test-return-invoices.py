"""Test the new per-invoice return endpoint."""
import requests, json, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'ACCOUNTING_SUPERVISOR'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Get all batches
resp = requests.get("http://localhost:3001/api/payment-batches", headers=headers, timeout=30)
batches = resp.json()
print(f"Found {len(batches)} batches")
for b in batches[:5]:
    print(f"  {b.get('batch_number','?')} | status={b.get('status','?')} | payments={len(b.get('payments',[]))}")

# Find a batch in PENDING_SUPERVISOR_REVIEW or DRAFT
testable = [b for b in batches if b.get('status') in ['PENDING_SUPERVISOR_REVIEW', 'DRAFT', 'RETURNED_FOR_CORRECTION']]
if testable:
    batch = testable[0]
    print(f"\nTesting with batch: {batch['batch_number']} (status={batch['status']})")
    payments = batch.get('payments', [])
    if payments:
        # Try returning one invoice
        payment_id = payments[0]['id']
        print(f"Returning payment: {payment_id} (invoice: {payments[0].get('invoice',{}).get('invoice_number','?')})")
        result = requests.post(
            f"http://localhost:3001/api/payment-batches/{batch['id']}/return-invoices",
            headers=headers,
            json={"paymentIds": [payment_id], "reason": "Test per-invoice return — needs revision"},
            timeout=30,
        )
        print(f"Status: {result.status_code}")
        print(json.dumps(result.json(), indent=2, default=str)[:500])
else:
    print("\nNo testable batches found (need PENDING_SUPERVISOR_REVIEW, DRAFT, or RETURNED_FOR_CORRECTION)")
