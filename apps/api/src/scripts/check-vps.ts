import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function main() {
  console.log('=== VPS Health Check ===\n');

  // 1. Check DB connection
  try {
    await prisma.$connect();
    console.log('✅ Database: CONNECTED');
  } catch (err) {
    console.log('❌ Database: CONNECTION FAILED -', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  }

  // 2. Count total invoices
  const totalInvoices = await prisma.invoice.count();
  console.log(`📊 Total invoices in DB: ${totalInvoices}`);

  // 3. Find invoices with MPO numbers (to test NextGen search)
  const invoicesWithMPO = await prisma.invoice.findMany({
    where: {
      mpo_number: { not: null as any },
    },
    select: {
      id: true,
      invoice_number: true,
      mpo_number: true,
      total_amount: true,
      status: true,
      vendor: { select: { name: true } },
      ocr_raw_data: true,
      bank_charges: true,
      freight_charges: true,
      additional_charges: true,
      discount_amount: true,
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  });

  console.log(`\n📋 Recent invoices with MPO numbers (${invoicesWithMPO.length} shown):`);
  for (const inv of invoicesWithMPO) {
    const rawData = inv.ocr_raw_data as any || {};
    const materialCode = rawData.material_code || 'N/A';
    const bankCharges = Number(inv.bank_charges || 0);
    const freightCharges = Number(inv.freight_charges || 0);
    const additionalCharges = Number(inv.additional_charges || 0);
    const discountAmount = Number(inv.discount_amount || 0);
    const totalCharges = bankCharges + freightCharges + additionalCharges;
    const netAmount = Number(inv.total_amount) - totalCharges + discountAmount;

    console.log(`  - Invoice: ${inv.invoice_number} | MPO: ${inv.mpo_number} | Material: ${materialCode} | Amount: $${Number(inv.total_amount).toFixed(2)} | Net (after charges): $${netAmount.toFixed(2)} | Charges: $${totalCharges.toFixed(2)} | Status: ${inv.status} | Vendor: ${inv.vendor?.name || 'N/A'}`);
  }

  // 4. Search for invoices with material_code containing ZVC
  const allInvoices = await prisma.invoice.findMany({
    where: {
      mpo_number: { not: null as any },
    },
    select: {
      invoice_number: true,
      mpo_number: true,
      total_amount: true,
      ocr_raw_data: true,
    },
    take: 500,
  });

  const zvcInvoices = allInvoices.filter((inv: any) => {
    const rawData = inv.ocr_raw_data as any || {};
    const mc = rawData.material_code || '';
    return mc.toUpperCase().includes('ZVC');
  });

  console.log(`\n🔍 Invoices with material_code containing 'ZVC': ${zvcInvoices.length}`);
  for (const inv of zvcInvoices.slice(0, 5)) {
    const rawData = inv.ocr_raw_data as any || {};
    console.log(`  - ${inv.invoice_number} | MPO: ${inv.mpo_number} | Material: ${rawData.material_code} | Amount: $${Number(inv.total_amount).toFixed(2)}`);
  }

  // 5. Check for ZVCT0014 specifically
  const zvct0014Invoices = allInvoices.filter((inv: any) => {
    const rawData = inv.ocr_raw_data as any || {};
    const mc = (rawData.material_code || '').toUpperCase();
    return mc.includes('ZVCT0014');
  });
  console.log(`\n🎯 Invoices with material_code 'ZVCT0014': ${zvct0014Invoices.length}`);

  // 6. Test NextGen connection
  console.log('\n=== NextGen Connection Test ===');
  const nextGenUrl = process.env.NEXTGEN_API_URL || 'https://nextgen.madison88.com';
  const nextGenUser = process.env.NEXTGEN_USERNAME || '';
  const nextGenPass = process.env.NEXTGEN_PASSWORD || '';
  console.log(`URL: ${nextGenUrl}`);
  console.log(`Username: ${nextGenUser ? 'configured' : 'NOT SET'}`);
  console.log(`Password: ${nextGenPass ? 'configured' : 'NOT SET'}`);

  if (nextGenUser && nextGenPass) {
    try {
      // Step 1: Get login page
      const loginPageRes = await fetch(`${nextGenUrl}/Account/Login`);
      const html = await loginPageRes.text();
      const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
      if (!tokenMatch) {
        console.log('❌ NextGen: Could not find anti-forgery token');
      } else {
        console.log('✅ NextGen: Login page accessible, anti-forgery token found');

        // Step 2: Login
        const pageCookies = loginPageRes.headers.getSetCookie?.() || [];
        const antiForgeryCookie = pageCookies.map((c: string) => c.split(';')[0]).join('; ');

        const loginRes = await fetch(`${nextGenUrl}/Account/Login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': antiForgeryCookie,
          },
          body: new URLSearchParams({
            '__RequestVerificationToken': tokenMatch[1],
            'Username': nextGenUser,
            'Password': nextGenPass,
          }).toString(),
          redirect: 'manual',
        });

        const loginCookies = loginRes.headers.getSetCookie?.() || [];
        if (loginRes.status === 302 && loginCookies.length > 0) {
          console.log('✅ NextGen: Login successful!');
          const allCookies = [...pageCookies.map((c: string) => c.split(';')[0]), ...loginCookies.map((c: string) => c.split(';')[0])].join('; ');

          // Step 3: Search for an MPO with ZVCT0014 material code
          console.log('\n=== NextGen MPO Search Test (ZVCT0014) ===');

          // Fetch MPO headers
          const mpoRes = await fetch(`${nextGenUrl}/MaterialPurchaseOrder/MPOGridRead`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': allCookies,
            },
            body: JSON.stringify({
              page: 1,
              pageSize: 500,
              sort: [{ field: 'Name', dir: 'desc' }],
              filter: null,
            }),
          });

          const mpoData: any = await mpoRes.json();
          const total = mpoData.Total || mpoData.total || 0;
          const items = mpoData.Data || mpoData.data || [];
          console.log(`MPO Grid: ${items.length} items on page 1, total: ${total}`);

          // Search for ZVCT0014 in reference fields
          const zvcMatches = items.filter((item: any) => {
            const refs = [item.Comments, item.Description, item.SupplierDescription, item.Name]
              .filter(Boolean).join(' ').toUpperCase();
            return refs.includes('ZVCT0014') || refs.includes('ZVC');
          });
          console.log(`MPOs matching 'ZVCT0014' or 'ZVC' on page 1: ${zvcMatches.length}`);
          for (const m of zvcMatches.slice(0, 5)) {
            console.log(`  - MPO: ${m.Name} | Supplier: ${m.SupplierName} | Total: $${Number(m.TotalCost || 0).toFixed(2)} | Comments: ${(m.Comments || '').substring(0, 80)}`);
          }

          if (zvcMatches.length === 0 && total > 500) {
            console.log(`\n⚠️  ZVCT0014 not found on page 1. Searching all ${total} records...`);
            const allItems: any[] = [...items];
            let page = 2;
            const totalPages = Math.ceil(total / 500);
            while (page <= totalPages && allItems.length < total) {
              const r = await fetch(`${nextGenUrl}/MaterialPurchaseOrder/MPOGridRead`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Cookie': allCookies,
                },
                body: JSON.stringify({ page, pageSize: 500, sort: [{ field: 'Name', dir: 'desc' }], filter: null }),
              });
              const d: any = await r.json();
              const pageItems = d.Data || d.data || [];
              if (pageItems.length === 0) break;
              allItems.push(...pageItems);
              page++;
            }
            console.log(`Fetched ${allItems.length} total MPOs`);

            const allZvcMatches = allItems.filter((item: any) => {
              const refs = [item.Comments, item.Description, item.SupplierDescription, item.Name]
                .filter(Boolean).join(' ').toUpperCase();
              return refs.includes('ZVCT0014') || refs.includes('ZVC');
            });
            console.log(`MPOs matching 'ZVCT0014' or 'ZVC' across all pages: ${allZvcMatches.length}`);
            for (const m of allZvcMatches.slice(0, 10)) {
              console.log(`  - MPO: ${m.Name} | Supplier: ${m.SupplierName} | Total: $${Number(m.TotalCost || 0).toFixed(2)} | Comments: ${(m.Comments || '').substring(0, 100)}`);
            }
          }
        } else {
          console.log(`❌ NextGen: Login failed (status ${loginRes.status}, cookies: ${loginCookies.length})`);
        }
      }
    } catch (err) {
      console.log('❌ NextGen error:', err instanceof Error ? err.message : 'unknown');
    }
  }

  await prisma.$disconnect();
  console.log('\n=== Check Complete ===');
}

main().catch(console.error);
