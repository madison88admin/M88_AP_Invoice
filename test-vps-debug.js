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

  // Test 1: POST with empty body (should get 400 validation error if body parsing works)
  const t1 = await req('POST', '/api/users', {}, token);
  console.log('1. POST empty body:', t1.status, JSON.stringify(t1.data).substring(0, 200));

  // Test 2: POST with missing fields
  const t2 = await req('POST', '/api/users', { name: 'Test' }, token);
  console.log('2. POST partial body:', t2.status, JSON.stringify(t2.data).substring(0, 200));

  // Test 3: PATCH with invalid ID
  const t3 = await req('PATCH', '/api/users/nonexistent-id', { name: 'Test' }, token);
  console.log('3. PATCH bad ID:', t3.status, JSON.stringify(t3.data).substring(0, 200));

  // Test 4: POST with full valid data
  const t4 = await req('POST', '/api/users', {
    name: 'Test User', email: 'testuser99@madison88.com',
    role: 'PURCHASING_COORDINATOR', password: 'testpass123'
  }, token);
  console.log('4. POST full valid:', t4.status, JSON.stringify(t4.data).substring(0, 200));

  // Test 5: POST auth login (this is a POST that works)
  const t5 = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  console.log('5. POST auth login:', t5.status);

  // Test 6: POST notifications (another POST endpoint)
  const t6 = await req('POST', '/api/notifications', {
    title: 'Test', message: 'Test message', type: 'info', category: 'stage'
  }, token);
  console.log('6. POST notifications:', t6.status, JSON.stringify(t6.data).substring(0, 200));

  // Test 7: PATCH invoice (another PATCH endpoint) - try to add a comment
  const t7 = await req('PATCH', '/api/invoices/PCI-26029807', { comment: 'Test comment from debug' }, token);
  console.log('7. PATCH invoice:', t7.status, JSON.stringify(t7.data).substring(0, 200));
})();
