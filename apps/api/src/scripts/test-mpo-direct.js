// Test specific MPO lookup with working login
const BASE_URL = 'https://nextgen.madison88.com';
const USERNAME = 'Glecie';
const PASSWORD = 'SZn6hrdo!';
const MPO_NUMBER = process.argv[2] || 'MPO015781';

async function login() {
  const getPage = await fetch(`${BASE_URL}/Account/Login`);
  const html = await getPage.text();
  const pageSetCookies = getPage.headers.getSetCookie?.() || [];
  
  const tokenRegex = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/;
  let tokenMatch = html.match(tokenRegex);
  if (!tokenMatch) tokenMatch = html.match(/__RequestVerificationToken[\s\S]*?value="([^"]+)"/);
  const token = tokenMatch[1];
  
  const pageCookieStr = pageSetCookies.map(c => c.split(';')[0]).join('; ');
  
  const loginRes = await fetch(`${BASE_URL}/Account/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': pageCookieStr,
    },
    body: new URLSearchParams({
      '__RequestVerificationToken': token,
      'Username': USERNAME,
      'Password': PASSWORD,
    }).toString(),
    redirect: 'manual',
  });
  
  const loginSetCookies = loginRes.headers.getSetCookie?.() || [];
  const cookieMap = {};
  for (const c of pageSetCookies) {
    const [name, ...rest] = c.split(';')[0].split('=');
    cookieMap[name.trim()] = rest.join('=');
  }
  for (const c of loginSetCookies) {
    const [name, ...rest] = c.split(';')[0].split('=');
    cookieMap[name.trim()] = rest.join('=');
  }
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function apiPost(cookieStr, body) {
  const res = await fetch(`${BASE_URL}/MaterialPurchaseOrder/MPOGridRead`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieStr,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (text.includes('Log In - VisionPLM')) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  console.log(`=== Testing MPO lookup: ${MPO_NUMBER} ===`);
  const cookieStr = await login();
  console.log('Login OK\n');
  
  const normalizedMPO = MPO_NUMBER.replace(/^MPO/i, '').replace(/^0+/, '');
  const mpoWithPrefix = `MPO${normalizedMPO.padStart(6, '0')}`;
  
  // Test 1: Filter by Name contains "15781"
  console.log('--- Test 1: Filter Name contains "15781" ---');
  let result = await apiPost(cookieStr, {
    page: 1, pageSize: 50, sort: [{ field: 'Name', dir: 'desc' }],
    filter: { field: 'Name', operator: 'contains', value: '15781' },
  });
  if (result?.Data) {
    console.log(`Found: ${result.Data.length} results, Total: ${result.Total}`);
    result.Data.forEach((item, i) => {
      console.log(`  [${i}] Name=${item.Name}, Id=${item.Id}, Supplier=${item.SupplierName}, TotalCost=${item.TotalCost}`);
    });
  } else {
    console.log('No results or login failed');
  }
  
  // Test 2: Filter by Name eq "MPO015781"
  console.log('\n--- Test 2: Filter Name eq "MPO015781" ---');
  result = await apiPost(cookieStr, {
    page: 1, pageSize: 50, sort: [{ field: 'Name', dir: 'desc' }],
    filter: { field: 'Name', operator: 'eq', value: 'MPO015781' },
  });
  if (result?.Data) {
    console.log(`Found: ${result.Data.length} results`);
    result.Data.forEach((item, i) => {
      console.log(`  [${i}] Name=${item.Name}, Id=${item.Id}, Supplier=${item.SupplierName}`);
    });
  } else {
    console.log('No results');
  }
  
  // Test 3: Or filter with multiple formats
  console.log('\n--- Test 3: Or filter with multiple formats ---');
  result = await apiPost(cookieStr, {
    page: 1, pageSize: 50, sort: [{ field: 'Name', dir: 'desc' }],
    filter: {
      logic: 'or',
      filters: [
        { field: 'Name', operator: 'eq', value: MPO_NUMBER },
        { field: 'Name', operator: 'eq', value: mpoWithPrefix },
        { field: 'Name', operator: 'contains', value: normalizedMPO },
        { field: 'Comments', operator: 'contains', value: MPO_NUMBER },
        { field: 'Description', operator: 'contains', value: MPO_NUMBER },
      ],
    },
  });
  if (result?.Data) {
    console.log(`Found: ${result.Data.length} results`);
    result.Data.forEach((item, i) => {
      console.log(`  [${i}] Name=${item.Name}, Id=${item.Id}, Supplier=${item.SupplierName}, TotalCost=${item.TotalCost}`);
      if (item.Comments) console.log(`       Comments: ${item.Comments.substring(0, 100)}`);
      if (item.Description) console.log(`       Description: ${item.Description.substring(0, 100)}`);
    });
  } else {
    console.log('No results');
  }
  
  // Test 4: No filter, search through pages for MPO015781
  console.log('\n--- Test 4: Paginated scan for MPO015781 ---');
  const PAGE_SIZE = 500;
  let page = 1;
  let found = null;
  let total = 0;
  
  while (!found) {
    result = await apiPost(cookieStr, {
      page, pageSize: PAGE_SIZE, sort: [{ field: 'Name', dir: 'desc' }], filter: null,
    });
    if (!result?.Data || result.Data.length === 0) {
      console.log(`Page ${page}: no data, stopping`);
      break;
    }
    total = result.Total || total;
    console.log(`Page ${page}: ${result.Data.length} items (total: ${total})`);
    
    // Check first and last item names
    console.log(`  First: ${result.Data[0]?.Name}, Last: ${result.Data[result.Data.length - 1]?.Name}`);
    
    found = result.Data.find(i => 
      i.Name === MPO_NUMBER || 
      i.Name === mpoWithPrefix ||
      i.Name?.includes(normalizedMPO) ||
      i.Name?.includes(MPO_NUMBER)
    );
    
    if (found) {
      console.log(`\n✓ FOUND on page ${page}: Name=${found.Name}, Id=${found.Id}, Supplier=${found.SupplierName}, TotalCost=${found.TotalCost}`);
    }
    
    page++;
    if ((page - 1) * PAGE_SIZE >= total) {
      console.log('Scanned all pages, not found');
      break;
    }
  }
}

main().catch(e => console.error(e));
