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
      status: true,
      created_at: true,
      total_amount: true,
      vendor: { select: { name: true } },
    },
  });
  console.log('Recent invoices (latest 10):');
  for (const inv of recent) {
    console.log(`  ${inv.invoice_number} | ${inv.status} | $${Number(inv.total_amount).toFixed(2)} | ${inv.vendor?.name || 'N/A'} | ${inv.created_at.toISOString()}`);
  }

  // Check for any OCR processing
  const processing = await prisma.invoice.findMany({
    where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
    select: { id: true, invoice_number: true, status: true, created_at: true },
  });
  console.log(`\nInvoices in OCR/Validation pipeline: ${processing.length}`);
  for (const inv of processing) {
    console.log(`  ${inv.invoice_number} | ${inv.status} | ${inv.created_at.toISOString()}`);
  }

  // Check recent audit logs
  const recentLogs = await prisma.audit_log.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: { action: true, note: true, created_at: true, invoice_id: true },
  });
  console.log(`\nRecent audit logs (latest 10):`);
  for (const log of recentLogs) {
    console.log(`  ${log.created_at.toISOString()} | ${log.action} | ${(log.note || '').substring(0, 80)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
