const http = require('http');

function reqDetailed(method, path, body, token) {
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
        console.log('Status:', s.statusCode);
        console.log('Headers:', JSON.stringify(s.headers, null, 2));
        console.log('Body:', b);
        try { resolve({ status: s.statusCode, data: JSON.parse(b), headers: s.headers }); }
        catch { resolve({ status: s.statusCode, data: b, headers: s.headers }); }
      });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const login = await reqDetailed('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  const token = login.data.token;

  console.log('\n=== POST /api/users (full response) ===');
  await reqDetailed('POST', '/api/users', {
    name: 'Test User', email: 'testuser99@madison88.com',
    role: 'PURCHASING_COORDINATOR', password: 'testpass123'
  }, token);

  console.log('\n=== PATCH /api/users/:id (full response) ===');
  // Get JC's ID
  const usersResp = await new Promise(resolve => {
    http.get({ hostname: '5.223.78.194', port: 80, path: '/api/users', headers: { 'Authorization': 'Bearer ' + token } }, s => {
      let b = '';
      s.on('data', c => b += c);
      s.on('end', () => resolve(JSON.parse(b)));
    });
  });
  const jc = usersResp.users?.find(u => u.email === 'jc@madison88.com');
  if (jc) {
    await reqDetailed('PATCH', '/api/users/' + jc.id, { name: 'JC' }, token);
  }
})();
