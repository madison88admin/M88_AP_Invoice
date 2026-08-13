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

  const users = await req('GET', '/api/users', null, token);
  // Show first 3 users with all fields
  console.log('First 3 users from VPS:');
  users.data.users?.slice(0, 3).forEach(u => {
    console.log(JSON.stringify(u, null, 2));
  });

  // Check if updatedAt is populated or null/undefined
  const hasUpdatedAt = users.data.users?.every(u => u.updatedAt);
  console.log('\nAll users have updatedAt:', hasUpdatedAt);
  console.log('Sample updatedAt:', users.data.users?.[0]?.updatedAt);
  console.log('Sample createdAt:', users.data.users?.[0]?.createdAt);
})();
