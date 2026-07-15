require('dotenv').config({ path: '/opt/ap-invoice/apps/api/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const GARBAGE_PATTERNS = /^(invoice\s+invoice|account\s+no|invoice\s+no|no\s+vendor|unknown|n\/a|)$/i;

function normalize(name) {
  return (name || '').toUpperCase()
    .replace(/(?:LTD|LIMITED|CO|CORP|CORPORATION|INC|LLC|PVT|PRIVATE|GMBH|SDN|BHD|SRL|SPA|BV|NV|SA|AG|OY|AB|AS|SAS|SARL|LLP|LP)\.?/g, '')
    .replace(/[.,\/&'()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

async function main() {
  const UNKNOWN_VENDOR_ID = '00000000-0000-0000-0000-000000000000';
  
  const unknownInvoices = await prisma.invoice.findMany({
    where: { vendor_id: UNKNOWN_VENDOR_ID },
    select: { id: true, invoice_number: true, vendor_name_raw: true, total_amount: true, currency: true, status: true },
    orderBy: { created_at: 'desc' },
  });

  console.log(`Invoices with UNKNOWN VENDOR: ${unknownInvoices.length}`);
  
  const allVendors = await prisma.vendor.findMany({
    select: { id: true, name: true, name_aliases: true, bank_name: true, swift_code: true, account_number: true },
  });
  console.log(`Total vendors in DB: ${allVendors.length}`);

  function matchVendor(vendorName) {
    const normalizedInput = normalize(vendorName);
    if (!normalizedInput) return null;
    for (const v of allVendors) {
      if (normalize(v.name) === normalizedInput) return v;
    }
    for (const v of allVendors) {
      for (const alias of (v.name_aliases || [])) {
        if (normalize(alias) === normalizedInput) return v;
      }
    }
    for (const v of allVendors) {
      const dist = levenshtein(normalizedInput, normalize(v.name));
      if (dist <= 3 && normalizedInput.length > 3) return v;
    }
    const inputTokens = normalizedInput.split(/\s+/).filter(t => t.length > 2);
    for (const v of allVendors) {
      const vendorTokens = normalize(v.name).split(/\s+/).filter(t => t.length > 2);
      const common = inputTokens.filter(t => vendorTokens.includes(t));
      if (common.length >= 2 && common.length / Math.max(inputTokens.length, vendorTokens.length) >= 0.5) return v;
    }
    return null;
  }

  let matched = 0, created = 0, skipped = 0;
  const newVendorMap = {};

  for (const inv of unknownInvoices) {
    const vendorName = (inv.vendor_name_raw || '').trim();
    
    if (!vendorName || vendorName.length <= 2 || GARBAGE_PATTERNS.test(vendorName)) {
      console.log(`SKIP  ${inv.invoice_number}: garbage name "${vendorName}"`);
      skipped++;
      continue;
    }

    const match = matchVendor(vendorName);
    if (match) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { vendor_id: match.id },
      });
      console.log(`MATCH ${inv.invoice_number}: "${vendorName}" -> "${match.name}"`);
      matched++;
      continue;
    }

    const normKey = normalize(vendorName);
    if (newVendorMap[normKey]) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { vendor_id: newVendorMap[normKey] },
      });
      console.log(`LINK  ${inv.invoice_number}: "${vendorName}" -> previously created vendor`);
      matched++;
      continue;
    }

    try {
      const newVendor = await prisma.vendor.create({
        data: {
          name: vendorName,
          name_aliases: [],
          invoice_template_type: 'INVOICE',
          is_active: true,
        },
      });
      newVendorMap[normKey] = newVendor.id;
      allVendors.push(newVendor);
      
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { vendor_id: newVendor.id },
      });
      console.log(`CREATE ${inv.invoice_number}: "${vendorName}" -> new vendor (id: ${newVendor.id})`);
      created++;
    } catch (err) {
      console.log(`FAIL  ${inv.invoice_number}: failed to create vendor "${vendorName}": ${err.message}`);
      skipped++;
    }
  }

  // Add "Nilorn East Asia Limited" as alias to "Nilorn HK"
  const nilornVendor = allVendors.find(v => v.name === 'Nilorn HK');
  if (nilornVendor && !nilornVendor.name_aliases.includes('Nilorn East Asia Limited')) {
    await prisma.vendor.update({
      where: { id: nilornVendor.id },
      data: { name_aliases: [...nilornVendor.name_aliases, 'Nilorn East Asia Limited'] },
    });
    console.log(`ALIAS: Added "Nilorn East Asia Limited" as alias to "Nilorn HK"`);
  }

  console.log('---');
  console.log(`Matched to existing: ${matched}`);
  console.log(`New vendors created: ${created}`);
  console.log(`Skipped (garbage/no name): ${skipped}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
