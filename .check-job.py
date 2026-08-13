import requests, json, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}"}
job_id = "b08cf0d2-7d8d-415c-a624-fd701394d8b8"

r = requests.get(f"http://localhost:3001/api/invoices/upload-jobs/{job_id}", headers=headers)
job = r.json()
print(f"Status: {job.get('status')}")
print(json.dumps(job, indent=2)[:1500])
