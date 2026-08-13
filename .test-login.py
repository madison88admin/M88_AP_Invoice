import requests, json
r = requests.post("http://localhost:3001/api/auth/login", json={
    "email": "jc@madison88.com",
    "password": "Ar5yG3#4"
})
print(f"Status: {r.status_code}")
print(f"Response: {r.text[:300]}")
