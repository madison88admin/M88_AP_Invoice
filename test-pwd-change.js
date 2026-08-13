const http = require('http');

function req(method, path, body, token) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const o = { hostname: 'localhost', port: 3001, path, method, headers };
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
  // Login as JC
  const login = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  console.log('1. Login:', login.status, login.data.user?.role);
  const token = login.data.token;

  // Get users list
  const users = await req('GET', '/api/users', null, token);
  console.log('2. GET /api/users:', users.status, 'count:', users.data.users?.length);

  // Find JC's user record in the database
  const jcUser = users.data.users?.find(u => u.email === 'jc@madison88.com');
  console.log('3. JC user in DB:', jcUser ? `id=${jcUser.id}` : 'NOT FOUND');

  if (jcUser) {
    // Try to change password
    const update = await req('PATCH', '/api/users/' + jcUser.id, { password: 'NewPass123' }, token);
    console.log('4. PATCH password:', update.status, JSON.stringify(update.data));

    if (update.status === 200) {
      // Verify new password works
      const loginNew = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'NewPass123' });
      console.log('5. Login with new password:', loginNew.status);

      // Revert back
      const revert = await req('PATCH', '/api/users/' + jcUser.id, { password: 'Ar5yG3#4' }, token);
      console.log('6. Revert password:', revert.status);
    }
  }

  // Try with a different user
  const pamela = users.data.users?.find(u => u.email === 'pamela@madison88.com');
  if (pamela) {
    const update2 = await req('PATCH', '/api/users/' + pamela.id, { password: 'TestPass456' }, token);
    console.log('7. PATCH Pamela password:', update2.status, JSON.stringify(update2.data));
    if (update2.status === 200) {
      const revert2 = await req('PATCH', '/api/users/' + pamela.id, { password: 'madison88' }, token);
      console.log('8. Revert Pamela password:', revert2.status);
    }
  }
})();
