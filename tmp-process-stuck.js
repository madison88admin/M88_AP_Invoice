
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // Get all stuck invoices
  const stuck = await p.invoice.findMany({
    where: { status: { in: ['OCR_PROCESSING', 'RECEIVED', 'VALIDATION_PENDING'] } },
    select: { id: true, invoice_number: true, status: true },
    orderBy: { created_at: 'desc' }
  });
  
  console.log('Found ' + stuck.length + ' stuck invoices');
  
  const { validateInvoice } = require('./dist/services/validationService');
  
  for (const inv of stuck) {
    try {
      console.log('Validating ' + inv.invoice_number + ' (' + inv.status + ')...');
      const result = await validateInvoice(inv.id);
      console.log('  -> passed: ' + (result && result.passed));
    } catch (e) {
      console.log('  -> ERROR: ' + (e.message || e));
    }
  }
  
  console.log('ALL DONE');
  await p.$disconnect();
}

run().catch(e => { console.error(e); p.$disconnect(); });
