process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Find the invoice
  const invoice = await prisma.$queryRawUnsafe(`
    SELECT id, invoice_number, vendor_name_raw, status, total_amount 
    FROM "AP_Invoice"."APInvoice_Invoice" 
    WHERE invoice_number = '251086'
  `);
  console.log('Found invoice:', JSON.stringify(invoice, null, 2));

  if (invoice.length === 0) {
    console.log('Invoice 251086 not found');
    await prisma.$disconnect();
    return;
  }

  const invoiceId = invoice[0].id;

  // Delete related records first (foreign key constraints)
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_AuditLog" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_Signature" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_Exception" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_StageTimestamp" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_InvoiceLine" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_Payment" WHERE invoice_id = $1`, invoiceId);
  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_Notification" WHERE invoice_id = $1`, invoiceId);
  
  // Delete the invoice
  const result = await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_Invoice" WHERE id = $1`, invoiceId);
  console.log(`Deleted ${result} invoice(s)`);

  // Verify
  const check = await prisma.$queryRawUnsafe(`SELECT id FROM "AP_Invoice"."APInvoice_Invoice" WHERE invoice_number = '251086'`);
  console.log('After delete:', check.length === 0 ? '✅ Invoice deleted successfully' : '❌ Still exists');

  await prisma.$disconnect();
})();
