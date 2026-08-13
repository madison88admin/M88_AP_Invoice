// Debug: check Node version and test login from same process environment
console.log('Node version:', process.version);
console.log('fetch available:', typeof fetch);

async function testLogin() {
  var testUrl = 'https://nextgen.madison88.com:8443';
  
  // Step 1: Get login page
  var r = await fetch(testUrl + '/Account/Login');
  var h = await r.text();
  var t = h.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  var cookie = r.headers.get('set-cookie').split(';')[0];
  console.log('Page cookie:', cookie.substring(0, 40) + '...');
  console.log('Token:', t[1].substring(0, 20) + '...');
  
  // Step 2: POST login with redirect:manual
  var b = new URLSearchParams({
    '__RequestVerificationToken': t[1],
    'UserName': 'jc',
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
  console.log('Set-Cookie:', r2.headers.get('set-cookie') ? 'HAS COOKIES' : 'null');
  
  if (r2.status === 302) {
    console.log('SUCCESS!');
    var authCookie = r2.headers.get('set-cookie');
    console.log('Auth cookie name:', authCookie.split('=')[0]);
  } else if (r2.status === 200) {
    var h2 = await r2.text();
    if (h2.includes('temporarily disabled')) {
      var m = h2.match(/try again in (\d+) minutes/);
      console.log('LOCKED - try again in', m ? m[1] : 'unknown', 'minutes');
    } else {
      console.log('FAILED - on login page, not locked');
    }
  }
}

testLogin().catch(console.error);
