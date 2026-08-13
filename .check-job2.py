import requests, json, subprocess

token = subprocess.check_output(["node", "-e", """
const jwt = require('jsonwebtoken');
console.log(jwt.sign({id:'jc-user-id',email:'jc@madison88.com',role:'IT_ADMIN'},'madison88-jwt-secret-dev',{expiresIn:'2h'}))
"""], cwd="/opt/ap-invoice/apps/api").decode().strip()

headers = {"Authorization": f"Bearer {token}"}
job_id = "4707ba58-23f1-4ca1-b2e4-be96c24421d5"

r = requests.get(f"http://localhost:3001/api/invoices/upload-jobs/{job_id}", headers=headers)
job = r.json()
print(f"Status: {job.get('status')}")
if job.get("result"):
    print(json.dumps(job.get("result"), indent=2)[:2000])
elif job.get("error"):
    print(f"Error: {job.get('error')}")
