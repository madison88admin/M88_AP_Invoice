require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.correctionLog.count();
  console.log('Total correction logs:', count);

  const topUsed = await prisma.correctionLog.findMany({
    select: { vendor_name: true, use_count: true, created_at: true, last_used_at: true },
    orderBy: { use_count: 'desc' },
    take: 10,
  });
  console.log('\nTop used corrections:');
  topUsed.forEach(l => {
    console.log(`  ${l.vendor_name} — used ${l.use_count}x, created: ${l.created_at?.toISOString().split('T')[0]}, last used: ${l.last_used_at?.toISOString().split('T')[0] || 'never'}`);
  });

  // Check current confidence scores on existing invoices
  const invoices = await prisma.invoice.findMany({
    select: { invoice_number: true, vendor_name_raw: true, ocr_confidence_score: true, status: true },
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  console.log('\n--- CURRENT CONFIDENCE SCORES ---');
  invoices.forEach(inv => {
    console.log(`  [${inv.invoice_number}] conf: ${Number(inv.ocr_confidence_score || 0).toFixed(2)} — vendor: "${inv.vendor_name_raw}" — status: ${inv.status}`);
  });

  // Check fine-tune status
  const { ollamaFineTuneService } = require('./ollamaFineTuneService');
  const ftStatus = ollamaFineTuneService.getStatus();
  console.log('\n--- FINE-TUNE STATUS ---');
  console.log(JSON.stringify(ftStatus, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
