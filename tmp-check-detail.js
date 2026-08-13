
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const stuck = await p.invoice.findMany({
    where: { status: 'VALIDATION_PENDING' },
    select: { id: true, invoice_number: true, mpo_number: true, vendor_name_raw: true, total_amount: true, invoice_date: true, currency: true },
    orderBy: { created_at: 'desc' }
  });
  
  for (const inv of stuck) {
    const exceptions = await p.exception.findMany({
      where: { invoice_id: inv.id },
      select: { type: true, message: true, resolved_at: true }
    });
    console.log(inv.invoice_number + ' | MPO: ' + (inv.mpo_number || 'NONE') + ' | Amount: ' + inv.total_amount + ' | Exceptions: ' + exceptions.length);
    exceptions.forEach(e => console.log('  -> ' + e.type + ': ' + (e.message || '').substring(0, 80)));
  }
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
