// Debug NextGen login with correct token regex + full login flow test
const BASE_URL = 'https://nextgen.madison88.com';
const USERNAME = 'Glecie';
const PASSWORD = 'SZn6hrdo!';

async function main() {
  // Step 1: GET login page
  console.log('=== Step 1: GET /Account/Login ===');
  const getPage = await fetch(`${BASE_URL}/Account/Login`);
  const html = await getPage.text();
  
  const pageSetCookies = getPage.headers.getSetCookie?.() || [];
  console.log('Page cookies:', pageSetCookies.length);
  
  // Use the SAME regex as the service code
  const tokenRegex = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/;
  const tokenRegex2 = /__RequestVerificationToken[\s\S]*?value="([^"]+)"/;
  let tokenMatch = html.match(tokenRegex);
  if (!tokenMatch) tokenMatch = html.match(tokenRegex2);
  
  if (!tokenMatch) {
    console.log('ERROR: Token not found!');
    return;
  }
  
  const token = tokenMatch[1];
  console.log('Token found:', token.substring(0, 30) + '...');
  
  const pageCookieStr = pageSetCookies.map(c => c.split(';')[0]).join('; ');
  console.log('Page cookie:', pageCookieStr.substring(0, 80));
  
  // Step 2: POST login with correct token
  console.log('\n=== Step 2: POST /Account/Login ===');
  const loginBody = new URLSearchParams({
    '__RequestVerificationToken': token,
    'Username': USERNAME,
    'Password': PASSWORD,
  });
  
  const loginRes = await fetch(`${BASE_URL}/Account/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': pageCookieStr,
    },
    body: loginBody.toString(),
    redirect: 'manual',
  });
  
  console.log('Login status:', loginRes.status);
  console.log('Location:', loginRes.headers.get('location'));
  
  const loginSetCookies = loginRes.headers.getSetCookie?.() || [];
  console.log('Login cookies:', loginSetCookies.length);
  loginSetCookies.forEach((c, i) => console.log(`  [${i}] ${c.substring(0, 120)}`));
  
  // Combine cookies
  const cookieMap = {};
  for (const c of pageSetCookies) {
    const [name, ...rest] = c.split(';')[0].split('=');
    cookieMap[name.trim()] = rest.join('=');
  }
  for (const c of loginSetCookies) {
    const [name, ...rest] = c.split(';')[0].split('=');
    cookieMap[name.trim()] = rest.join('=');
  }
  const fullCookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  console.log('All cookie names:', Object.keys(cookieMap).join(', '));
  
  if (loginRes.status !== 302 || loginSetCookies.length === 0) {
    console.log('\nLogin may have failed. Checking response body...');
    const body = await loginRes.text();
    console.log('Body (first 500):', body.substring(0, 500));
    
    // Check if location is back to login (failure) or to dashboard (success)
    const location = loginRes.headers.get('location');
    if (location === '/Account/Login') {
      console.log('\n⚠️ Login FAILED - redirected back to login page');
      console.log('Check credentials or account status');
      return;
    }
  }
  
  // Step 3: Test API call with full cookies
  console.log('\n=== Step 3: POST /MaterialPurchaseOrder/MPOGridRead ===');
  const apiRes = await fetch(`${BASE_URL}/MaterialPurchaseOrder/MPOGridRead`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': fullCookieStr,
    },
    body: JSON.stringify({
      page: 1,
      pageSize: 5,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: null,
    }),
  });
  
  console.log('API status:', apiRes.status);
  const apiText = await apiRes.text();
  
  if (apiText.includes('Log In - VisionPLM')) {
    console.log('⚠️ Still getting login page!');
    
    // Maybe we need to follow the redirect after login to get the actual session cookie
    console.log('\n=== Step 3b: Follow login redirect ===');
    const redirectUrl = loginRes.headers.get('location');
    if (redirectUrl) {
      const redirectRes = await fetch(`${BASE_URL}${redirectUrl}`, {
        headers: { 'Cookie': fullCookieStr },
        redirect: 'manual',
      });
      console.log('Redirect status:', redirectRes.status);
      const redirectCookies = redirectRes.headers.getSetCookie?.() || [];
      console.log('Redirect cookies:', redirectCookies.length);
      redirectCookies.forEach((c, i) => console.log(`  [${i}] ${c.substring(0, 120)}`));
      
      // Add redirect cookies
      for (const c of redirectCookies) {
        const [name, ...rest] = c.split(';')[0].split('=');
        cookieMap[name.trim()] = rest.join('=');
      }
      const updatedCookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
      
      // Retry API call
      console.log('\n=== Step 3c: Retry API with updated cookies ===');
      const apiRes2 = await fetch(`${BASE_URL}/MaterialPurchaseOrder/MPOGridRead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': updatedCookieStr,
        },
        body: JSON.stringify({
          page: 1,
          pageSize: 5,
          sort: [{ field: 'Name', dir: 'desc' }],
          filter: null,
        }),
      });
      
      const apiText2 = await apiRes2.text();
      if (apiText2.includes('Log In')) {
        console.log('Still login page. Cookie names:', Object.keys(cookieMap).join(', '));
      } else {
        console.log('SUCCESS! Response (first 300):', apiText2.substring(0, 300));
      }
    }
  } else {
    console.log('SUCCESS! Response (first 300):', apiText.substring(0, 300));
    try {
      const json = JSON.parse(apiText);
      console.log('Total:', json.Total, 'Data count:', json.Data?.length);
      if (json.Data?.[0]) {
        console.log('First item:', json.Data[0].Name, json.Data[0].Id);
      }
    } catch (e) {}
  }
}

main().catch(e => console.error(e));
