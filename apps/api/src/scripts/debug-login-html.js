// Debug: print login page HTML to find the token format
const BASE_URL = 'https://nextgen.madison88.com';

async function main() {
  const getPage = await fetch(`${BASE_URL}/Account/Login`);
  const html = await getPage.text();
  
  // Search for any token-like patterns
  console.log('=== Looking for RequestVerificationToken ===');
  
  // Pattern 1: standard hidden input
  const p1 = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
  console.log('Pattern 1 (name then value):', p1 ? 'FOUND' : 'not found');
  
  // Pattern 2: value then name
  const p2 = html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/);
  console.log('Pattern 2 (value then name):', p2 ? 'FOUND: ' + p2[1].substring(0, 30) : 'not found');
  
  // Pattern 3: any mention of RequestVerificationToken
  const idx = html.indexOf('RequestVerificationToken');
  if (idx >= 0) {
    console.log('\nFound "RequestVerificationToken" at index', idx);
    console.log('Context:', html.substring(Math.max(0, idx - 100), idx + 200));
  } else {
    console.log('\n"RequestVerificationToken" NOT found in HTML at all');
  }
  
  // Look for any hidden inputs
  console.log('\n=== All hidden inputs ===');
  const hiddenInputs = html.matchAll(/<input[^>]*type="hidden"[^>]*>/g);
  for (const m of hiddenInputs) {
    console.log(m[0]);
  }
  
  // Look for form tags
  console.log('\n=== Form tags ===');
  const forms = html.matchAll(/<form[^>]*>/g);
  for (const m of forms) {
    console.log(m[0]);
  }
  
  // Print first 3000 chars of HTML
  console.log('\n=== HTML (first 3000 chars) ===');
  console.log(html.substring(0, 3000));
}

main().catch(e => console.error(e));
