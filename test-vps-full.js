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

  // POST create - see full error
  const t1 = await req('POST', '/api/users', {
    name: 'Test User', email: 'testuser99@madison88.com',
    role: 'PURCHASING_COORDINATOR', password: 'testpass123'
  }, token);
  console.log('POST create:', t1.status, JSON.stringify(t1.data, null, 2));

  // PATCH password
  const users = await req('GET', '/api/users', null, token);
  const jc = users.data.users?.find(u => u.email === 'jc@madison88.com');
  if (jc) {
    const t2 = await req('PATCH', '/api/users/' + jc.id, { password: 'NewTest123' }, token);
    console.log('\nPATCH password:', t2.status, JSON.stringify(t2.data, null, 2));
    if (t2.status === 200) {
      // Revert
      await req('PATCH', '/api/users/' + jc.id, { password: 'Ar5yG3#4' }, token);
    }
  }
})();
