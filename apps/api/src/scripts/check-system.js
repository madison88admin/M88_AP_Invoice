require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const total = await prisma.invoice.count();
  const pending = await prisma.invoice.count({ where: { status: 'VALIDATION_PENDING' } });
  const approved = await prisma.invoice.count({ where: { status: 'APPROVED' } });
  const flagged = await prisma.invoice.count({ where: { status: 'EXCEPTION_FLAGGED' } });
  const corrections = await prisma.correctionLog.count();
  const vendors = await prisma.vendor.count();
  const recentInvoices = await prisma.invoice.findMany({
    select: { invoice_number: true, vendor_name_raw: true, status: true, ocr_confidence_score: true, created_at: true, invoice_type: true },
    orderBy: { created_at: 'desc' },
    take: 5,
  });

  console.log('=== DATABASE STATS ===');
  console.log(`  Total invoices: ${total}`);
  console.log(`  Pending: ${pending}`);
  console.log(`  Approved: ${approved}`);
  console.log(`  Exception flagged: ${flagged}`);
  console.log(`  Corrections: ${corrections}`);
  console.log(`  Vendors: ${vendors}`);
  console.log('\n=== RECENT INVOICES ===');
  for (const inv of recentInvoices) {
    console.log(`  [${inv.status}] ${inv.vendor_name_raw || 'N/A'} — ${inv.invoice_number || 'N/A'} — conf: ${inv.ocr_confidence_score || 'N/A'} — ${inv.created_at?.toISOString().split('T')[0]}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
