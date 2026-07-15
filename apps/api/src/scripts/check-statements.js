require('dotenv').config({ path: '/opt/ap-invoice/apps/api/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check for STATEMENT-type invoices
  const statements = await prisma.invoice.findMany({
    where: { invoice_type: 'STATEMENT' },
    select: {
      id: true,
      invoice_number: true,
      vendor_name_raw: true,
      total_amount: true,
      status: true,
      invoice_date: true,
      vendor: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  console.log('=== STATEMENT-type invoices ===');
  console.log('Count:', statements.length);
  for (const s of statements) {
    console.log(`  ${s.invoice_number} | vendor: ${s.vendor?.name || s.vendor_name_raw} | amount: ${s.total_amount} | status: ${s.status} | date: ${s.invoice_date}`);
  }

  // Check for invoices with is_statement in ocr_raw_data
  const allInvoices = await prisma.invoice.findMany({
    where: { invoice_type: { not: 'STATEMENT' } },
    select: {
      id: true,
      invoice_number: true,
      invoice_type: true,
      ocr_raw_data: true,
      vendor_name_raw: true,
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });

  const statementFlagged = allInvoices.filter(i => {
    const raw = i.ocr_raw_data;
    return raw && (raw.is_statement === true || raw.document_type === 'STATEMENT');
  });

  console.log('\n=== Invoices with is_statement=true in OCR data but NOT invoice_type=STATEMENT ===');
  console.log('Count:', statementFlagged.length);
  for (const s of statementFlagged) {
    console.log(`  ${s.invoice_number} | type: ${s.invoice_type} | raw.is_statement: ${s.ocr_raw_data?.is_statement} | raw.document_type: ${s.ocr_raw_data?.document_type}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
