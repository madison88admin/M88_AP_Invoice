require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recent = await prisma.invoice.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: {
      id: true,
      invoice_number: true,
      vendor_name_raw: true,
      mpo_number: true,
      account_number: true,
      bank_name: true,
      swift_code: true,
      qty_shipped: true,
      total_amount: true,
      ocr_raw_data: true,
      ocr_confidence_score: true,
    },
  });

  for (const inv of recent) {
    console.log('\n=== ' + inv.invoice_number + ' ===');
    console.log('  mpo_number:', inv.mpo_number || 'MISSING');
    console.log('  account_number:', inv.account_number || 'MISSING');
    console.log('  bank_name:', inv.bank_name || 'MISSING');
    console.log('  swift_code:', inv.swift_code || 'MISSING');
    console.log('  qty_shipped:', inv.qty_shipped || 'MISSING');
    console.log('  ocr_confidence:', inv.ocr_confidence_score);
    
    const raw = inv.ocr_raw_data;
    if (raw) {
      console.log('  [RAW] mpo_number:', raw.mpo_number || 'MISSING');
      console.log('  [RAW] account_number:', raw.bank_account || raw.account_number || 'MISSING');
      console.log('  [RAW] bank_name:', raw.bank_name || (raw.bank_info && raw.bank_info.bank_name) || 'MISSING');
      console.log('  [RAW] swift_code:', raw.bank_swift || raw.swift_code || (raw.bank_info && raw.bank_info.swift_code) || 'MISSING');
      console.log('  [RAW] qty_shipped:', raw.qty_shipped || 'MISSING');
      console.log('  [RAW] bank_info:', JSON.stringify(raw.bank_info) || 'NONE');
      console.log('  [RAW] extraction_method:', raw.extraction_method || raw.ocr_engine || 'UNKNOWN');
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
