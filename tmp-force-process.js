
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Get stuck invoices with NO exceptions
  const stuck = await p.invoice.findMany({
    where: { status: 'VALIDATION_PENDING' },
    select: { id: true, invoice_number: true, mpo_number: true, vendor_name_raw: true },
    orderBy: { created_at: 'desc' }
  });
  
  console.log('Checking ' + stuck.length + ' invoices...');
  let moved = 0;
  
  for (const inv of stuck) {
    const exceptions = await p.exception.findMany({
      where: { invoice_id: inv.id, resolved_at: null },
      select: { id: true }
    });
    
    if (exceptions.length === 0) {
      // No unresolved exceptions - move to PENDING_COORDINATOR
      await p.invoice.update({
        where: { id: inv.id },
        data: { status: 'PENDING_COORDINATOR' }
      });
      console.log('MOVED: ' + inv.invoice_number + ' -> PENDING_COORDINATOR');
      moved++;
    } else {
      // Has exceptions - move to EXCEPTION_FLAGGED
      await p.invoice.update({
        where: { id: inv.id },
        data: { status: 'EXCEPTION_FLAGGED' }
      });
      console.log('MOVED: ' + inv.invoice_number + ' -> EXCEPTION_FLAGGED (' + exceptions.length + ' exceptions)');
      moved++;
    }
  }
  
  console.log('Total moved: ' + moved);
  
  // Verify
  const remaining = await p.invoice.count({ where: { status: 'VALIDATION_PENDING' } });
  console.log('Remaining VALIDATION_PENDING: ' + remaining);
  
  await p.$disconnect();
}
run().catch(e => { console.error(e); p.$disconnect(); });
