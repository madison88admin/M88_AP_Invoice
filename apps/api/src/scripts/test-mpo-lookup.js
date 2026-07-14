// Quick diagnostic: test NextGen MPO lookup for a specific MPO number
// Usage: node src/scripts/test-mpo-lookup.js MPO015781

const MPO_NUMBER = process.argv[2] || 'MPO015781';
const BASE_URL = process.env.NEXTGEN_API_URL || 'https://nextgen.madison88.com';
const USERNAME = process.env.NEXTGEN_USERNAME || 'Glecie';
const PASSWORD = process.env.NEXTGEN_PASSWORD || 'SZn6hrdo!';

async function login() {
  // Step 1: GET login page for cookies + token
  const getPage = await fetch(`${BASE_URL}/Account/Login`);
  const html = await getPage.text();
  const pageCookies = getPage.headers.getSetCookie?.() || [];
  
  // Extract anti-forgery token
  const tokenMatch = html.match(/name="__RequestVerificationToken"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';
  
  // Combine cookies
  let cookieStr = pageCookies.map(c => c.split(';')[0]).join('; ');
  
  // Step 2: POST login
  const body = new URLSearchParams({
    '__RequestVerificationToken': token,
    'Username': USERNAME,
    'Password': PASSWORD,
  });
  
  const loginRes = await fetch(`${BASE_URL}/Account/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieStr,
    },
    body: body.toString(),
    redirect: 'manual',
  });
  
  const loginCookies = loginRes.headers.getSetCookie?.() || [];
  const allCookies = [...pageCookies, ...loginCookies].map(c => c.split(';')[0]);
  const uniqueCookies = [...new Set(allCookies)];
  cookieStr = uniqueCookies.join('; ');
  
  console.log(`Login status: ${loginRes.status}`);
  console.log(`Cookies: ${cookieStr.substring(0, 80)}...`);
  
  return cookieStr;
}

async function testEndpoint(name, url, method, body, cookieStr) {
  console.log(`\n--- ${name} ---`);
  console.log(`${method} ${url}`);
  
  try {
    const headers = { 'Cookie': cookieStr };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    
    const res = await fetch(`${BASE_URL}${url}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    
    console.log(`Status: ${res.status}`);
    
    if (!res.ok) {
      const text = await res.text();
      console.log(`Response (first 500 chars): ${text.substring(0, 500)}`);
      return null;
    }
    
    const text = await res.text();
    // Try to parse as JSON
    try {
      const json = JSON.parse(text);
      if (json.Data) {
        console.log(`Data count: ${Array.isArray(json.Data) ? json.Data.length : 'not array'}`);
        console.log(`Total: ${json.Total || 'N/A'}`);
        if (Array.isArray(json.Data) && json.Data.length > 0) {
          console.log(`First item Name: ${json.Data[0].Name}`);
          console.log(`First item Id: ${json.Data[0].Id}`);
          console.log(`First item SupplierName: ${json.Data[0].SupplierName}`);
        }
      } else {
        console.log(`Response (first 500 chars): ${text.substring(0, 500)}`);
      }
      return json;
    } catch (e) {
      console.log(`Response (first 500 chars): ${text.substring(0, 500)}`);
      return null;
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`=== Testing MPO lookup for: ${MPO_NUMBER} ===`);
  console.log(`Base URL: ${BASE_URL}`);
  
  const cookieStr = await login();
  if (!cookieStr) {
    console.log('Login failed!');
    return;
  }
  
  const normalizedMPO = MPO_NUMBER.replace(/^MPO/i, '').replace(/^0+/, '');
  const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`;
  const numericId = parseInt(normalizedMPO);
  
  console.log(`\nNormalized: ${normalizedMPO}`);
  console.log(`With prefix: ${mpoWithPrefix}`);
  console.log(`Numeric ID: ${numericId}`);
  
  // Test 1: GetById
  await testEndpoint(
    'GetById',
    `/MaterialPurchaseOrder/GetById?id=${numericId}`,
    'GET',
    null,
    cookieStr
  );
  
  // Test 2: GetHeader
  await testEndpoint(
    'GetHeader',
    `/MaterialPurchaseOrder/GetHeader?id=${numericId}`,
    'GET',
    null,
    cookieStr
  );
  
  // Test 3: Kendo grid filter - exact Name match
  await testEndpoint(
    'MPOGridRead - Name eq',
    '/MaterialPurchaseOrder/MPOGridRead',
    'POST',
    {
      page: 1,
      pageSize: 50,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: {
        logic: 'or',
        filters: [
          { field: 'Name', operator: 'eq', value: MPO_NUMBER },
          { field: 'Name', operator: 'eq', value: mpoWithPrefix },
          { field: 'Name', operator: 'contains', value: normalizedMPO },
        ],
      },
    },
    cookieStr
  );
  
  // Test 4: Kendo grid filter - contains on Name
  await testEndpoint(
    'MPOGridRead - Name contains MPO015781',
    '/MaterialPurchaseOrder/MPOGridRead',
    'POST',
    {
      page: 1,
      pageSize: 50,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: {
        field: 'Name',
        operator: 'contains',
        value: MPO_NUMBER,
      },
    },
    cookieStr
  );
  
  // Test 5: Kendo grid filter - contains on just the number
  await testEndpoint(
    'MPOGridRead - Name contains 15781',
    '/MaterialPurchaseOrder/MPOGridRead',
    'POST',
    {
      page: 1,
      pageSize: 50,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: {
        field: 'Name',
        operator: 'contains',
        value: '15781',
      },
    },
    cookieStr
  );
  
  // Test 6: No filter, just first page to see what format Names have
  await testEndpoint(
    'MPOGridRead - no filter (first page sample)',
    '/MaterialPurchaseOrder/MPOGridRead',
    'POST',
    {
      page: 1,
      pageSize: 5,
      sort: [{ field: 'Name', dir: 'desc' }],
      filter: null,
    },
    cookieStr
  );
  
  // Test 7: GetEntityBrowserList
  await testEndpoint(
    'GetEntityBrowserList',
    '/MaterialPurchaseOrder/GetEntityBrowserList',
    'GET',
    null,
    cookieStr
  );
}

main().catch(e => console.error(e));
