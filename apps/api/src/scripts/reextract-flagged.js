/**
 * Re-extract all EXCEPTION_FLAGGED invoices using the new AI-first approach.
 * Downloads PDF from SharePoint, runs analyzeInvoice (AI-first), updates the DB.
 */
require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Get all EXCEPTION_FLAGGED invoices
  const flaggedInvoices = await prisma.invoice.findMany({
    where: { status: 'EXCEPTION_FLAGGED' },
    include: { exceptions: true, vendor: true },
  });

  console.log(`=== RE-EXTRACTION SCRIPT ===`);
  console.log(`Found ${flaggedInvoices.length} EXCEPTION_FLAGGED invoices\n`);

  if (flaggedInvoices.length === 0) {
    console.log('No flagged invoices to re-extract. Done.');
    return;
  }

  // Load the reExtractInvoice function from compiled dist
  const { reExtractInvoice } = require('../../dist/services/reprocessService');
  
  // Use a system user ID for the re-extraction
  const systemUserId = 'system-reextract';

  for (const invoice of flaggedInvoices) {
    console.log(`\n--- Re-extracting: ${invoice.invoice_number} (${invoice.vendor_name_raw}) ---`);
    console.log(`  ID: ${invoice.id}`);
    console.log(`  Current status: ${invoice.status}`);
    console.log(`  SharePoint URL: ${invoice.sharepoint_folder_url || 'N/A'}`);
    console.log(`  Raw file URL: ${invoice.raw_file_url || 'N/A'}`);
    
    // Show current exceptions
    if (invoice.exceptions && invoice.exceptions.length > 0) {
      console.log(`  Current exceptions:`);
      for (const exc of invoice.exceptions) {
        console.log(`    - [${exc.status}] ${exc.reason}: ${exc.detail || 'N/A'}`);
      }
    }

    try {
      const result = await reExtractInvoice(invoice.id, systemUserId);
      console.log(`  ✅ Result: ${result.message}`);
      if (result.old_values && result.new_values) {
        const changedFields = Object.keys(result.new_values).filter(k => {
          const oldVal = JSON.stringify(result.old_values[k]);
          const newVal = JSON.stringify(result.new_values[k]);
          return oldVal !== newVal && newVal !== 'null' && newVal !== 'undefined';
        });
        if (changedFields.length > 0) {
          console.log(`  Changed fields: ${changedFields.join(', ')}`);
          for (const field of changedFields) {
            console.log(`    ${field}: ${JSON.stringify(result.old_values[field])} → ${JSON.stringify(result.new_values[field])}`);
          }
        } else {
          console.log(`  No fields changed (AI extracted same values)`);
        }
      }
    } catch (err) {
      console.log(`  ❌ Failed: ${err.message}`);
    }
  }

  // Show final status
  console.log('\n=== FINAL STATUS ===');
  const finalInvoices = await prisma.invoice.findMany({
    where: { id: { in: flaggedInvoices.map(i => i.id) } },
    select: { id: true, invoice_number: true, vendor_name_raw: true, status: true, ocr_confidence_score: true },
  });
  for (const inv of finalInvoices) {
    console.log(`  [${inv.status}] ${inv.vendor_name_raw} — ${inv.invoice_number} — conf: ${inv.ocr_confidence_score}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
