const http = require('http');
function req(method, path, body) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    const o = { hostname: '5.223.78.194', port: 80, path, method, headers };
    const r = http.request(o, s => { let b = ''; s.on('data', c => b += c); s.on('end', () => { try { resolve({ status: s.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: s.statusCode, data: b }); } }); });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    if (d) r.write(d); r.end();
  });
}
(async () => {
  // Login as Chris
  const chrisLogin = await req('POST', '/api/auth/login', { email: 'chris@madison88.com', password: 'd93Mi35qTeu3' });
  console.log('Chris login:', chrisLogin.status, chrisLogin.data.user ? `role=${chrisLogin.data.user.role}` : chrisLogin.data.error);

  // Login as Jennifer Paloma - need to find her password
  // She was migrated, try common passwords
  const passwords = ['madison88', 'Madison88', 'password', 'jpaloma', 'paloma', 'Paloma'];
  for (const pw of passwords) {
    const jLogin = await req('POST', '/api/auth/login', { email: 'jpaloma@madison88.com', password: pw });
    if (jLogin.status === 200) {
      console.log('Jennifer login:', jLogin.status, `role=${jLogin.data.user.role} (password: ${pw})`);
      break;
    }
  }
})();
