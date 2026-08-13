// Debug the exact cookie extraction difference
async function main() {
  var testUrl = 'https://nextgen.madison88.com:8443';
  var r = await fetch(testUrl + '/Account/Login');
  var h = await r.text();
  var t = h.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  
  // Method 1: raw header (test script way)
  var rawCookie = r.headers.get('set-cookie');
  var cookie1 = rawCookie ? rawCookie.split(';')[0] : '';
  console.log('Method 1 (raw header):', cookie1);
  
  // Method 2: getSetCookie (service way)
  var cookies2 = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  var cookie2 = cookies2.map(function(c) { return c.split(';')[0]; }).join('; ');
  console.log('Method 2 (getSetCookie):', cookie2);
  console.log('getSetCookie available:', typeof r.headers.getSetCookie === 'function');
  console.log('getSetCookie result:', cookies2);
  
  // Method 3: raw header split by comma (service fallback)
  var cookies3 = rawCookie ? rawCookie.split(/,(?=[^;]+=[^;]+)/g).map(function(c) { return c.trim(); }) : [];
  var cookie3 = cookies3.map(function(c) { return c.split(';')[0]; }).join('; ');
  console.log('Method 3 (fallback):', cookie3);
  
  // Now test login with each method
  var b = new URLSearchParams({
    '__RequestVerificationToken': t[1],
    'UserName': 'jc',
    'Password': 'Ar5yG3#4',
    'FromAdobeIllustrator': 'False',
  });
  
  // Test with Method 1
  var r1 = await fetch(testUrl + '/Account/Login?ReturnUrl=%2F', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie1 },
    body: b.toString(),
    redirect: 'manual',
  });
  console.log('\nMethod 1 login:', r1.status, r1.headers.get('set-cookie') ? 'HAS COOKIES' : 'NO COOKIES');
  
  // Need fresh token for method 2
  var r3 = await fetch(testUrl + '/Account/Login');
  var h3 = await r3.text();
  var t3 = h3.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  var cookies2b = typeof r3.headers.getSetCookie === 'function' ? r3.headers.getSetCookie() : [];
  var cookie2b = cookies2b.map(function(c) { return c.split(';')[0]; }).join('; ');
  
  var b2 = new URLSearchParams({
    '__RequestVerificationToken': t3[1],
    'UserName': 'jc',
    'Password': 'Ar5yG3#4',
    'FromAdobeIllustrator': 'False',
  });
  
  var r2 = await fetch(testUrl + '/Account/Login?ReturnUrl=%2F', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookie2b },
    body: b2.toString(),
    redirect: 'manual',
  });
  console.log('Method 2 login:', r2.status, r2.headers.get('set-cookie') ? 'HAS COOKIES' : 'NO COOKIES');
}
main().catch(console.error);
