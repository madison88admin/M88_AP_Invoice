process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Get ALL invoices with their status
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT id, invoice_number, vendor_name_raw, status, total_amount, invoice_type, mpo_number, customer_po_number, created_at
    FROM "AP_Invoice"."APInvoice_Invoice" 
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log('All invoices:');
  invoices.forEach(i => {
    console.log(`  ${i.invoice_number} | ${i.vendor_name_raw} | ${i.status} | $${i.total_amount} | type=${i.invoice_type} | mpo=${i.mpo_number} | po=${i.customer_po_number} | ${i.created_at.toISOString().split('T')[0]}`);
  });

  // Count by status
  const counts = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*) as count
    FROM "AP_Invoice"."APInvoice_Invoice"
    GROUP BY status
    ORDER BY count DESC
  `);
  console.log('\nStatus counts:');
  counts.forEach(c => console.log(`  ${c.status}: ${c.count}`));

  // Check signatures for invoices that should be postable
  for (const inv of invoices.slice(0, 5)) {
    const sigs = await prisma.$queryRawUnsafe(`
      SELECT signatory_role, signed_at, approval_status, invalidated_at
      FROM "AP_Invoice"."APInvoice_Signature"
      WHERE invoice_id = $1
      ORDER BY created_at ASC
    `, inv.id);
    const allSigned = sigs.length > 0 && sigs.every(s => s.signed_at !== null);
    console.log(`\n${inv.invoice_number} (${inv.status}) — sigs: ${sigs.length}, all signed: ${allSigned}`);
    sigs.forEach(s => {
      console.log(`  ${s.signatory_role} | signed=${s.signed_at ? 'YES' : 'NO'} | status=${s.approval_status} | invalidated=${s.invalidated_at ? 'YES' : 'NO'}`);
    });

    // Check exceptions
    const excs = await prisma.$queryRawUnsafe(`
      SELECT reason, status, detail
      FROM "AP_Invoice"."APInvoice_Exception"
      WHERE invoice_id = $1
    `, inv.id);
    if (excs.length > 0) {
      console.log(`  Exceptions:`);
      excs.forEach(e => console.log(`    ${e.reason} | ${e.status} | ${(e.detail || '').substring(0, 80)}`));
    }
  }

  await prisma.$disconnect();
})();
