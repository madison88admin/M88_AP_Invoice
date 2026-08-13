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

  // Test 1: POST notification (NO @updatedAt) — should work
  const t1 = await req('POST', '/api/notifications', {
    title: 'Test', message: 'Test', type: 'info', category: 'stage'
  }, token);
  console.log('1. POST notification (no @updatedAt):', t1.status);

  // Test 2: GET invoices to find one to update
  const invoices = await req('GET', '/api/invoices?limit=1', null, token);
  const inv = invoices.data.invoices?.[0];
  console.log('2. Sample invoice:', inv?.invoice_number);

  if (inv) {
    // Test 3: PATCH invoice (HAS @updatedAt) — might fail
    const t3 = await req('PATCH', '/api/invoices/' + inv.invoice_number, { comment: 'Test debug comment' }, token);
    console.log('3. PATCH invoice (has @updatedAt):', t3.status, JSON.stringify(t3.data).substring(0, 200));
  }

  // Test 4: POST vendor (check if Vendor has @updatedAt)
  // Let's try creating a vendor
  const t4 = await req('POST', '/api/vendors', {
    vendor_code: 'TEST123',
    vendor_name: 'Test Vendor Debug',
    payment_terms: 'NET30'
  }, token);
  console.log('4. POST vendor:', t4.status, JSON.stringify(t4.data).substring(0, 200));

  // Test 5: POST bank change request (has @updatedAt)
  if (inv) {
    const t5 = await req('POST', '/api/bank-changes', {
      invoice_id: inv.id,
      field: 'bank_account',
      current_value: 'old',
      requested_value: 'new'
    }, token);
    console.log('5. POST bank-change (has @updatedAt):', t5.status, JSON.stringify(t5.data).substring(0, 200));
  }

  // Test 6: POST approval (check if Approval has @updatedAt)
  if (inv) {
    const t6 = await req('POST', '/api/invoices/' + inv.invoice_number + '/approve', {
      level: 'PLANNING_MANAGER',
      comment: 'Test debug'
    }, token);
    console.log('6. POST approval:', t6.status, JSON.stringify(t6.data).substring(0, 200));
  }
})();
