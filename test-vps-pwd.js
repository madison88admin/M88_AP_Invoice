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
  // Login as JC
  const login = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  console.log('1. Login VPS:', login.status, login.data.user?.role || JSON.stringify(login.data));
  const token = login.data.token;

  // Get users list
  const users = await req('GET', '/api/users', null, token);
  console.log('2. GET /api/users VPS:', users.status, 'count:', users.data.users?.length || JSON.stringify(users.data).substring(0, 200));

  // Find JC's user record
  const jcUser = users.data.users?.find(u => u.email === 'jc@madison88.com');
  console.log('3. JC user in DB:', jcUser ? `id=${jcUser.id}` : 'NOT FOUND');

  if (jcUser) {
    // Try to change password
    const update = await req('PATCH', '/api/users/' + jcUser.id, { password: 'NewPass123' }, token);
    console.log('4. PATCH password VPS:', update.status, JSON.stringify(update.data).substring(0, 300));

    if (update.status === 200) {
      // Revert
      const revert = await req('PATCH', '/api/users/' + jcUser.id, { password: 'Ar5yG3#4' }, token);
      console.log('5. Revert password VPS:', revert.status);
    }
  }
})();
