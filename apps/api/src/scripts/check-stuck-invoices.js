const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT 
      i.id,
      i.invoice_number,
      i.status,
      i.current_approver_role,
      i.total_amount,
      i.created_at,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.signed_at IS NOT NULL) as signed_count,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.signed_at IS NULL) as unsigned_count,
      (SELECT string_agg(s.signatory_role || ':' || 
         (CASE WHEN s.signed_at IS NOT NULL THEN 'SIGNED' ELSE 'PENDING' END), ', ') 
       FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id) as sig_status
    FROM "AP_Invoice"."APInvoice_Invoice" i
    WHERE i.status IN (
      'PENDING_COORDINATOR','PENDING_MANAGER',
      'PENDING_MLO_ACCOUNT_HOLDER','PENDING_MLO_PLANNING_MANAGER',
      'PENDING_SR_MANAGER','PENDING_POLLY'
    )
    ORDER BY i.created_at DESC
    LIMIT 50
  `);

  console.log(`\n=== Invoices in approval workflow: ${invoices.length} ===\n`);
  
  const stuck = [];
  for (const inv of invoices) {
    const signedCount = Number(inv.signed_count);
    const unsignedCount = Number(inv.unsigned_count);
    const isStuck = signedCount > 0 && unsignedCount > 0;
    
    console.log(`Invoice: ${inv.invoice_number}`);
    console.log(`  Status: ${inv.status} | Approver: ${inv.current_approver_role || 'N/A'}`);
    console.log(`  Signed: ${signedCount} | Pending: ${unsignedCount}`);
    console.log(`  Signatures: ${inv.sig_status || 'none'}`);
    console.log(`  Amount: ${inv.total_amount}`);
    console.log(`  Created: ${inv.created_at}`);
    
    if (isStuck) {
      console.log(`  ⚠️ STUCK — has ${signedCount} signed signatures but still has ${unsignedCount} pending!`);
      stuck.push(inv);
    }
    console.log('');
  }

  console.log(`\n=== Summary: ${invoices.length} in workflow, ${stuck.length} potentially stuck ===`);
  
  // Also check invoices where ALL signatures are signed but status is still pending
  const fullySigned = await prisma.$queryRawUnsafe(`
    SELECT 
      i.id, i.invoice_number, i.status, i.current_approver_role,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id) as total_sigs,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.signed_at IS NOT NULL) as signed_count
    FROM "AP_Invoice"."APInvoice_Invoice" i
    WHERE i.status::text LIKE 'PENDING_%'
      AND i.status != 'PENDING_ACCOUNTING'
      AND i.status != 'VALIDATION_PENDING'
  `);
  
  const allSignedButStuck = fullySigned.filter(function(inv) {
    return Number(inv.total_sigs) > 0 && Number(inv.signed_count) === Number(inv.total_sigs);
  });
  
  if (allSignedButStuck.length > 0) {
    console.log(`\n=== CRITICAL: ${allSignedButStuck.length} invoices where ALL signatures signed but still pending! ===`);
    for (const inv of allSignedButStuck) {
      console.log(`  ${inv.invoice_number} — status: ${inv.status}, signatures: ${inv.signed_count}/${inv.total_sigs} signed`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
