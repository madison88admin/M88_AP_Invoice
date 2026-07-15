const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const correctionCount = await prisma.correctionLog.count();
  console.log('=== Correction Log ===');
  console.log('Total corrections:', correctionCount);

  const recentCorrections = await prisma.correctionLog.findMany({
    take: 5,
    orderBy: { created_at: 'desc' },
    select: {
      vendor_name: true,
      invoice_template_type: true,
      use_count: true,
      created_at: true,
    },
  });
  console.log('Recent corrections:', JSON.stringify(recentCorrections, null, 2));

  const vendorTemplates = await prisma.vendorTemplate.count();
  console.log('\n=== Vendor Templates ===');
  console.log('Total templates:', vendorTemplates);

  const templates = await prisma.vendorTemplate.findMany({
    take: 10,
    select: { vendor_name: true, template_type: true, accuracy_score: true, usage_count: true },
  });
  console.log('Templates:', JSON.stringify(templates, null, 2));

  const invoiceCount = await prisma.invoice.count();
  console.log('\n=== Invoices ===');
  console.log('Total invoices:', invoiceCount);

  const byStatus = await prisma.invoice.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log('By status:', JSON.stringify(byStatus, null, 2));

  const exceptions = await prisma.exception.count();
  console.log('Total exceptions:', exceptions);

  const exceptionReasons = await prisma.exception.groupBy({
    by: ['reason'],
    _count: true,
  });
  console.log('Exception reasons:', JSON.stringify(exceptionReasons, null, 2));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
