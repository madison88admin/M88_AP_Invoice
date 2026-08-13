// Test login from within the same ts-node-dev environment
console.log('Node version:', process.version);

async function testLogin() {
  var testUrl = 'https://nextgen.madison88.com';
  
  var r = await fetch(testUrl + '/Account/Login');
  var h = await r.text();
  var t = h.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  var cookieRaw = r.headers.get('set-cookie') || '';
  var cookie = cookieRaw.split(';')[0];
  console.log('Page cookie:', cookie.substring(0, 40) + '...');
  
  var b = new URLSearchParams({
    '__RequestVerificationToken': t?.[1] || '',
    'UserName': 'carlo',
    'Password': 'Ar5yG3#4',
    'FromAdobeIllustrator': 'False',
  });
  
  var r2 = await fetch(testUrl + '/Account/Login?ReturnUrl=%2F', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookie,
    },
    body: b.toString(),
    redirect: 'manual',
  });
  
  console.log('Login status:', r2.status);
  console.log('Has cookies:', !!r2.headers.get('set-cookie'));
  
  if (r2.status === 302) {
    console.log('SUCCESS - login works from ts-node context!');
  } else {
    console.log('FAILED from ts-node context');
    var h2 = await r2.text();
    console.log('Body first 200:', h2.substring(0, 200));
  }
}

testLogin().catch(function(e) { console.error('Error:', e); });
