require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: { status: 'EXCEPTION_FLAGGED' },
    select: { id: true, invoice_number: true, vendor_name_raw: true, ocr_raw_data: true, exceptions: true },
  });

  console.log(`=== ${invoices.length} EXCEPTION_FLAGGED invoices ===\n`);
  for (const inv of invoices) {
    const raw = inv.ocr_raw_data;
    const textLen = raw?.raw_text?.length || 0;
    const hasRaw = !!raw?.raw_text;
    const keys = Object.keys(raw || {}).join(', ');
    const excs = inv.exceptions.map(e => `${e.reason}: ${e.detail || ''}`).join('; ');
    console.log(`${inv.invoice_number} (${inv.vendor_name_raw})`);
    console.log(`  raw_text: ${hasRaw ? `YES (${textLen} chars)` : 'NO'}`);
    console.log(`  ocr_raw_data keys: ${keys}`);
    console.log(`  exceptions: ${excs}`);
    console.log('');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
