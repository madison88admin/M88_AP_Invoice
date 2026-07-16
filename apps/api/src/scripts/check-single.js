require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const inv = await prisma.invoice.findFirst({
    where: { invoice_number: { contains: '250427' } },
    select: {
      id: true,
      invoice_number: true,
      vendor_name_raw: true,
      total_amount: true,
      status: true,
      invoice_type: true,
      created_at: true,
      source: true,
      ocr_raw_data: true,
      vendor: { select: { name: true } },
    },
  });

  if (!inv) {
    console.log('Invoice 250427: NOT FOUND');
  } else {
    console.log('=== Invoice 250427 ===');
    console.log('ID:', inv.id);
    console.log('Number:', inv.invoice_number);
    console.log('Vendor:', inv.vendor?.name || inv.vendor_name_raw);
    console.log('Amount: $' + Number(inv.total_amount).toFixed(2));
    console.log('Type:', inv.invoice_type);
    console.log('Status:', inv.status);
    console.log('Source:', inv.source);
    console.log('Created:', inv.created_at.toISOString());
    if (inv.ocr_raw_data) {
      console.log('OCR confidence:', inv.ocr_raw_data.ocr_confidence_score);
      console.log('OCR method:', inv.ocr_raw_data.extraction_method);
      console.log('is_statement:', inv.ocr_raw_data.is_statement);
      console.log('document_type:', inv.ocr_raw_data.document_type);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
