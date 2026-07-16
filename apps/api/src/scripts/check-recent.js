require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const recent = await prisma.invoice.findMany({
    orderBy: { created_at: 'desc' },
    take: 15,
    select: {
      id: true,
      invoice_number: true,
      status: true,
      created_at: true,
      total_amount: true,
      invoice_type: true,
      source: true,
      vendor_name_raw: true,
      vendor: { select: { name: true } },
    },
  });
  console.log('=== Recent 15 Invoices ===');
  for (const inv of recent) {
    const date = inv.created_at.toISOString().substring(0, 16);
    console.log(`${date} | ${inv.invoice_number} | ${inv.vendor?.name || inv.vendor_name_raw || 'N/A'} | $${Number(inv.total_amount).toFixed(2)} | ${inv.invoice_type} | ${inv.status} | ${inv.source || 'unknown'}`);
  }

  // Count today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = await prisma.invoice.count({
    where: { created_at: { gte: today } },
  });
  console.log('\nInvoices created today:', todayCount);

  // Invoices in pipeline
  const processing = await prisma.invoice.findMany({
    where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
    select: { id: true, invoice_number: true, status: true, created_at: true },
  });
  console.log('Invoices in OCR/Validation pipeline:', processing.length);
  for (const inv of processing) {
    console.log(`  ${inv.invoice_number} | ${inv.status} | ${inv.created_at.toISOString()}`);
  }

  // Recent audit logs
  const recentLogs = await prisma.auditLog.findMany({
    orderBy: { created_at: 'desc' },
    take: 10,
    select: { action: true, note: true, created_at: true, invoice_id: true },
  });
  console.log('\n=== Recent Audit Logs ===');
  for (const log of recentLogs) {
    console.log(`  ${log.created_at.toISOString().substring(0,16)} | ${log.action} | ${(log.note || '').substring(0, 80)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
