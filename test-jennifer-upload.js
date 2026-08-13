const http = require('http');

function login(email, password) {
  return new Promise(resolve => {
    const body = JSON.stringify({ email, password });
    const req = http.request({
      hostname: '5.223.78.194', port: 80, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(b) })); });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(body); req.end();
  });
}

function testUpload(token) {
  return new Promise(resolve => {
    // Create a minimal fake PDF
    const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const boundary = '----TestBoundary' + Date.now();
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-upload.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), fakePdf, Buffer.from(footer)]);

    const req = http.request({
      hostname: '5.223.78.194', port: 80, path: '/api/invoices/upload-madison-async', method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: b.substring(0, 500) }); } }); });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.write(body); req.end();
  });
}

(async () => {
  // Login as Jennifer
  const loginResult = await login('jpaloma@madison88.com', 'madison88');
  console.log('Login:', loginResult.status, loginResult.data.user ? `role=${loginResult.data.user.role}` : loginResult.data.error);

  if (loginResult.status === 200 && loginResult.data.token) {
    // Test upload endpoint
    const uploadResult = await testUpload(loginResult.data.token);
    console.log('Upload test:', uploadResult.status, JSON.stringify(uploadResult.data).substring(0, 300));
    
    if (uploadResult.status === 403) {
      console.log('\n❌ STILL BLOCKED — insufficient permission');
    } else if (uploadResult.status === 401) {
      console.log('\n❌ AUTH FAILED');
    } else if (uploadResult.status === 200 || uploadResult.status === 201 || uploadResult.status === 202) {
      console.log('\n✅ UPLOAD ALLOWED — permission granted');
    } else {
      console.log(`\n⚠️ Status ${uploadResult.status} — not a permission error (upload endpoint accessible)`);
    }
  }
})();
