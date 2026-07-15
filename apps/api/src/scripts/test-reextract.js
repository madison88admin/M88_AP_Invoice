const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get a few invoices that have SharePoint URLs so we can re-download the PDF
  const invoices = await prisma.invoice.findMany({
    where: { 
      sharepoint_folder_url: { not: null },
    },
    select: { id: true, invoice_number: true, vendor_name_raw: true, status: true, sharepoint_folder_url: true },
    take: 3,
  });

  console.log('Found invoices to re-extract:', invoices.length);
  for (const inv of invoices) {
    console.log(`  - ${inv.invoice_number} | ${inv.vendor_name_raw} | ${inv.status}`);
  }

  if (invoices.length === 0) {
    console.log('No invoices found to re-extract');
    return;
  }

  // Call reExtractInvoice directly
  const { reExtractInvoice } = require('../../dist/services/reprocessService');
  
  for (const inv of invoices) {
    console.log(`\n--- Re-extracting invoice ${inv.invoice_number} (${inv.id}) ---`);
    try {
      const result = await reExtractInvoice(inv.id, 'system');
      console.log(`  Success: ${JSON.stringify(result).substring(0, 500)}`);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    // Wait between requests
    await new Promise(r => setTimeout(r, 3000));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
