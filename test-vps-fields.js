const http = require('http');

function req(method, path, body, token) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const o = { hostname: '5.223.78.194', port: 80, path, method, headers };
    const r = http.request(o, s => {
      let b = '';
      s.on('data', c => b += c);
      s.on('end', () => {
        try { resolve({ status: s.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: s.statusCode, data: b }); }
      });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  const token = login.data.token;

  // Get users
  const usersResp = await new Promise(resolve => {
    http.get({ hostname: '5.223.78.194', port: 80, path: '/api/users', headers: { 'Authorization': 'Bearer ' + token } }, s => {
      let b = ''; s.on('data', c => b += c); s.on('end', () => resolve(JSON.parse(b)));
    });
  });
  const pamela = usersResp.users?.find(u => u.email === 'pamela@madison88.com');

  // Test 1: PATCH name only (known to work)
  const t1 = await req('PATCH', '/api/users/' + pamela.id, { name: 'Pamela Test' }, token);
  console.log('1. PATCH name only:', t1.status);
  await req('PATCH', '/api/users/' + pamela.id, { name: 'Pamela' }, token); // revert

  // Test 2: PATCH password (includes password_hash in data)
  const t2 = await req('PATCH', '/api/users/' + pamela.id, { password: 'NewPass123' }, token);
  console.log('2. PATCH password:', t2.status, JSON.stringify(t2.data).substring(0, 200));
  if (t2.status === 200) {
    await req('PATCH', '/api/users/' + pamela.id, { password: 'madison88' }, token); // revert
  }

  // Test 3: PATCH role only
  const t3 = await req('PATCH', '/api/users/' + pamela.id, { role: 'ACCOUNTING_ASSOCIATE' }, token);
  console.log('3. PATCH role only:', t3.status);
  if (t3.status === 200) {
    await req('PATCH', '/api/users/' + pamela.id, { role: 'PURCHASING_COORDINATOR' }, token); // revert
  }

  // Test 4: PATCH active only
  const t4 = await req('PATCH', '/api/users/' + pamela.id, { active: false }, token);
  console.log('4. PATCH active only:', t4.status);
  if (t4.status === 200) {
    await req('PATCH', '/api/users/' + pamela.id, { active: true }, token); // revert
  }

  // Test 5: PATCH email only
  const t5 = await req('PATCH', '/api/users/' + pamela.id, { email: 'pamela.test@madison88.com' }, token);
  console.log('5. PATCH email only:', t5.status, JSON.stringify(t5.data).substring(0, 200));
  if (t5.status === 200) {
    await req('PATCH', '/api/users/' + pamela.id, { email: 'pamela@madison88.com' }, token); // revert
  }
})();
