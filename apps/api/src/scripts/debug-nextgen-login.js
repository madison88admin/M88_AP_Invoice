// Debug NextGen login + cookie capture
const BASE_URL = 'https://nextgen.madison88.com';
const USERNAME = 'Glecie';
const PASSWORD = 'SZn6hrdo!';

async function main() {
  // Step 1: GET login page
  console.log('=== Step 1: GET /Account/Login ===');
  const getPage = await fetch(`${BASE_URL}/Account/Login`);
  const html = await getPage.text();
  
  const pageSetCookies = getPage.headers.getSetCookie?.() || [];
  console.log('Page set-cookie headers:', pageSetCookies.length);
  pageSetCookies.forEach((c, i) => console.log(`  [${i}] ${c.substring(0, 100)}`));
  
  // Also check raw headers
  const rawHeaders = getPage.headers;
  console.log('\nAll response headers:');
  rawHeaders.forEach((v, k) => console.log(`  ${k}: ${v.substring(0, 100)}`));
  
  // Extract token
  const tokenMatch = html.match(/name="__RequestVerificationToken"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';
  console.log(`\nToken found: ${token ? 'yes (' + token.substring(0, 20) + '...)' : 'NO'}`);
  
  // Build cookie string from page
  const pageCookieStr = pageSetCookies.map(c => c.split(';')[0]).join('; ');
  console.log(`Page cookie string: ${pageCookieStr.substring(0, 120)}`);
  
  // Step 2: POST login
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
  
  console.log(`Login status: ${loginRes.status}`);
  console.log(`Login status text: ${loginRes.statusText}`);
  
  const loginSetCookies = loginRes.headers.getSetCookie?.() || [];
  console.log(`Login set-cookie headers: ${loginSetCookies.length}`);
  loginSetCookies.forEach((c, i) => console.log(`  [${i}] ${c.substring(0, 120)}`));
  
  console.log('\nLogin response headers:');
  loginRes.headers.forEach((v, k) => console.log(`  ${k}: ${v.substring(0, 150)}`));
  
  // Combine all cookies
  const allCookieNames = new Set();
  const cookieMap = {};
  
  for (const c of pageSetCookies) {
    const [pair] = c.split(';');
    const [name, val] = pair.split('=');
    cookieMap[name.trim()] = val;
    allCookieNames.add(name.trim());
  }
  for (const c of loginSetCookies) {
    const [pair] = c.split(';');
    const [name, val] = pair.split('=');
    cookieMap[name.trim()] = val;
    allCookieNames.add(name.trim());
  }
  
  console.log(`\nAll cookie names: ${[...allCookieNames].join(', ')}`);
  const fullCookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
  console.log(`Full cookie string: ${fullCookieStr.substring(0, 200)}`);
  
  // Step 3: Test POST to MPOGridRead with full cookies
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
  
  console.log(`API status: ${apiRes.status}`);
  const apiText = await apiRes.text();
  console.log(`API response (first 300): ${apiText.substring(0, 300)}`);
  
  // Check if we got redirected to login
  if (apiText.includes('Log In - VisionPLM')) {
    console.log('\n⚠️ Still getting login page! Cookies not working.');
    console.log('Let me try following the redirect...');
    
    // Try without redirect: manual
    const apiRes2 = await fetch(`${BASE_URL}/MaterialPurchaseOrder/MPOGridRead`, {
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
      redirect: 'follow',
    });
    
    console.log(`API2 status: ${apiRes2.status}`);
    console.log(`API2 url: ${apiRes2.url}`);
    const apiText2 = await apiRes2.text();
    console.log(`API2 response (first 300): ${apiText2.substring(0, 300)}`);
  } else {
    console.log('\n✓ API call succeeded!');
    try {
      const json = JSON.parse(apiText);
      console.log(`Data count: ${json.Data?.length || 0}, Total: ${json.Total}`);
      if (json.Data?.[0]) {
        console.log(`First: Name=${json.Data[0].Name}, Id=${json.Data[0].Id}`);
      }
    } catch (e) {
      console.log('Not JSON');
    }
  }
}

main().catch(e => console.error(e));
