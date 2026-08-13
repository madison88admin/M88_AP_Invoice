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

  // Test 1: POST with existing email (should get 409 if findFirst works)
  const t1 = await req('POST', '/api/users', {
    name: 'JC Duplicate', email: 'jc@madison88.com',
    role: 'SUPERADMIN', password: 'test123'
  }, token);
  console.log('1. POST existing email:', t1.status, JSON.stringify(t1.data).substring(0, 200));

  // Test 2: POST with existing email but different case
  const t2 = await req('POST', '/api/users', {
    name: 'JC Dup', email: 'JC@MADISON88.COM',
    role: 'SUPERADMIN', password: 'test123'
  }, token);
  console.log('2. POST existing email diff case:', t2.status, JSON.stringify(t2.data).substring(0, 200));

  // Test 3: POST with invalid role (should get 400)
  const t3 = await req('POST', '/api/users', {
    name: 'Test', email: 'test@test.com',
    role: 'INVALID_ROLE', password: 'test123'
  }, token);
  console.log('3. POST invalid role:', t3.status, JSON.stringify(t3.data).substring(0, 200));

  // Test 4: PATCH with only name change (no password, no email)
  const users = await req('GET', '/api/users', null, token);
  const pamela = users.data.users?.find(u => u.email === 'pamela@madison88.com');
  if (pamela) {
    const t4 = await req('PATCH', '/api/users/' + pamela.id, { name: 'Pamela Test' }, token);
    console.log('4. PATCH name only:', t4.status, JSON.stringify(t4.data).substring(0, 200));

    // Revert
    await req('PATCH', '/api/users/' + pamela.id, { name: 'Pamela' }, token);
  }

  // Test 5: PATCH with only active change
  if (pamela) {
    const t5 = await req('PATCH', '/api/users/' + pamela.id, { active: false }, token);
    console.log('5. PATCH active only:', t5.status, JSON.stringify(t5.data).substring(0, 200));
    await req('PATCH', '/api/users/' + pamela.id, { active: true }, token);
  }

  // Test 6: PATCH with only role change
  if (pamela) {
    const t6 = await req('PATCH', '/api/users/' + pamela.id, { role: 'ACCOUNTING_ASSOCIATE' }, token);
    console.log('6. PATCH role only:', t6.status, JSON.stringify(t6.data).substring(0, 200));
    await req('PATCH', '/api/users/' + pamela.id, { role: 'PURCHASING_COORDINATOR' }, token);
  }
})();
