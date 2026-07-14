require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Search for Trimco invoices
  const trimco = await prisma.invoice.findMany({
    where: {
      OR: [
        { invoice_number: { contains: 'TRIMCO', mode: 'insensitive' } },
        { invoice_number: { contains: '560267', mode: 'insensitive' } },
        { invoice_number: { contains: '544913', mode: 'insensitive' } },
        { raw_file_url: { contains: 'TRIMCO', mode: 'insensitive' } },
        { raw_file_url: { contains: '560267', mode: 'insensitive' } },
        { raw_file_url: { contains: '544913', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      invoice_number: true,
      status: true,
      total_amount: true,
      raw_file_url: true,
      created_at: true,
      vendor: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });
  console.log('Trimco invoices found:', trimco.length);
  for (const inv of trimco) {
    console.log(`  ID: ${inv.id}`);
    console.log(`  Invoice #: ${inv.invoice_number}`);
    console.log(`  Status: ${inv.status}`);
    console.log(`  Amount: $${Number(inv.total_amount).toFixed(2)}`);
    console.log(`  Vendor: ${inv.vendor?.name || 'N/A'}`);
    console.log(`  File: ${inv.raw_file_url || 'N/A'}`);
    console.log(`  Created: ${inv.created_at.toISOString()}`);
    console.log('');
  }

  // Also check all invoices created today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayInvoices = await prisma.invoice.findMany({
    where: { created_at: { gte: today } },
    select: {
      id: true,
      invoice_number: true,
      status: true,
      raw_file_url: true,
      created_at: true,
      vendor: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });
  console.log(`\nAll invoices created today (${todayInvoices.length}):`);
  for (const inv of todayInvoices) {
    console.log(`  ${inv.invoice_number} | ${inv.status} | ${inv.vendor?.name || 'N/A'} | ${inv.raw_file_url || 'N/A'} | ${inv.created_at.toISOString()}`);
  }

  // Check exceptions with details
  const exceptions = await prisma.exception.findMany({
    include: {
      invoice: { select: { id: true, invoice_number: true, status: true, vendor: { select: { name: true } } } },
    },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  console.log(`\nRecent exceptions (${exceptions.length}):`);
  for (const exc of exceptions) {
    console.log(`  ${exc.invoice.invoice_number} | ${exc.reason} | ${exc.status} | ${(exc.detail || '').substring(0, 100)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
