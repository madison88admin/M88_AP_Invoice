const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const invoice = await prisma.invoice.findFirst({
    where: { ocr_raw_data: { not: null } },
    select: { id: true, vendor_name_raw: true, ocr_raw_data: true }
  });
  if (invoice) {
    console.log('Invoice:', invoice.id, invoice.vendor_name_raw);
    const raw = invoice.ocr_raw_data;
    console.log('ocr_raw_data keys:', Object.keys(raw || {}));
    const rawStr = JSON.stringify(raw);
    console.log('ocr_raw_data length:', rawStr.length);
    console.log('ocr_raw_data preview:', rawStr.substring(0, 500));
  } else {
    console.log('No invoices with ocr_raw_data found');
  }
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
