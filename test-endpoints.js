const http = require('http');

function req(method, path, body, token) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const o = { hostname: '5.223.78.194', port: 80, path, method, headers, timeout: 5000 };
    const r = http.request(o, s => {
      let b = '';
      s.on('data', c => b += c);
      s.on('end', () => {
        try { resolve({ status: s.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: s.statusCode, data: b.substring(0, 200) }); }
      });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const login = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  const token = login.data.token;

  // Try various potential debug/deploy endpoints
  const endpoints = [
    ['GET', '/api/health'],
    ['GET', '/api/debug'],
    ['GET', '/api/restart'],
    ['GET', '/api/deploy'],
    ['GET', '/api/reload'],
    ['GET', '/api/version'],
    ['GET', '/api/status'],
    ['GET', '/api/env'],
    ['GET', '/api/config'],
    ['POST', '/api/restart'],
    ['POST', '/api/deploy'],
    ['POST', '/api/reload'],
    ['GET', '/health'],
    ['GET', '/healthz'],
    ['GET', '/api/prisma/generate'],
    ['GET', '/api/admin/restart'],
    ['POST', '/api/admin/restart', {}],
  ];

  for (const [method, path, body] of endpoints) {
    const result = await req(method, path, body, token);
    console.log(`${method} ${path}: ${result.status} ${typeof result.data === 'string' ? result.data.substring(0, 100) : JSON.stringify(result.data).substring(0, 100)}`);
  }
})();
