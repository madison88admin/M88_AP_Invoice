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

  // Test 1: Create user (POST)
  const created = await req('POST', '/api/users', {
    name: 'Test User', email: 'testuser99@madison88.com',
    role: 'PURCHASING_COORDINATOR', password: 'testpass123'
  }, token);
  console.log('POST create:', created.status, JSON.stringify(created.data).substring(0, 200));
  const userId = created.data.user?.id;

  if (userId) {
    // Test 2: Update name only (PATCH)
    const updateName = await req('PATCH', '/api/users/' + userId, { name: 'Test User 2' }, token);
    console.log('PATCH name:', updateName.status, JSON.stringify(updateName.data).substring(0, 200));

    // Test 3: Update password only (PATCH)
    const updatePwd = await req('PATCH', '/api/users/' + userId, { password: 'newpass456' }, token);
    console.log('PATCH password:', updatePwd.status, JSON.stringify(updatePwd.data).substring(0, 200));

    // Test 4: Update role only (PATCH)
    const updateRole = await req('PATCH', '/api/users/' + userId, { role: 'ACCOUNTING_ASSOCIATE' }, token);
    console.log('PATCH role:', updateRole.status, JSON.stringify(updateRole.data).substring(0, 200));

    // Test 5: Update active only (PATCH)
    const updateActive = await req('PATCH', '/api/users/' + userId, { active: false }, token);
    console.log('PATCH active:', updateActive.status, JSON.stringify(updateActive.data).substring(0, 200));

    // Cleanup
    const deleted = await req('DELETE', '/api/users/' + userId, null, token);
    console.log('DELETE:', deleted.status);
  }
})();
