const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check all invoices that have signatures
  const invoices = await prisma.$queryRawUnsafe(`
    SELECT 
      i.id, i.invoice_number, i.status, i.current_approver_role,
      i.total_amount, i.created_at,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id) as total_sigs,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.signed_at IS NOT NULL) as signed_count,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.signed_at IS NULL) as unsigned_count,
      (SELECT string_agg(s.signatory_role || ':' || 
         (CASE WHEN s.signed_at IS NOT NULL THEN 'SIGNED' ELSE 'PENDING' END), ', ') 
       FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id) as sig_status
    FROM "AP_Invoice"."APInvoice_Invoice" i
    WHERE EXISTS (
      SELECT 1 FROM "AP_Invoice"."APInvoice_Signature" s 
      WHERE s.invoice_id = i.id
    )
    ORDER BY i.created_at DESC
    LIMIT 50
  `);

  console.log(`\n=== Invoices with signatures: ${invoices.length} ===\n`);
  
  for (const inv of invoices) {
    const signedCount = Number(inv.signed_count);
    const unsignedCount = Number(inv.unsigned_count);
    const totalSigs = Number(inv.total_sigs);
    const allSigned = signedCount === totalSigs && totalSigs > 0;
    const hasPartialSignatures = signedCount > 0 && unsignedCount > 0;
    
    let flag = '';
    if (allSigned && inv.status !== 'PENDING_ACCOUNTING' && inv.status !== 'APPROVED' 
        && inv.status !== 'POSTED_TO_QB' && inv.status !== 'PAYMENT_SCHEDULED' 
        && inv.status !== 'PAID' && inv.status !== 'PAYMENT_CONFIRMATION_SENT') {
      flag = ' ⚠️ ALL SIGNED BUT NOT ADVANCED!';
    } else if (hasPartialSignatures) {
      flag = ' (partial signatures)';
    }
    
    console.log(`${inv.invoice_number} | ${inv.status} | ${signedCount}/${totalSigs} signed${flag}`);
    if (flag) {
      console.log(`  Signatures: ${inv.sig_status}`);
      console.log(`  Approver: ${inv.current_approver_role || 'N/A'}`);
    }
  }

  // Also check invoices in EXCEPTION_FLAGGED or VALIDATION_PENDING that have OCR signatures
  const ocrSigned = await prisma.$queryRawUnsafe(`
    SELECT i.id, i.invoice_number, i.status, i.total_amount,
      (SELECT COUNT(*) FROM "AP_Invoice"."APInvoice_Signature" s 
       WHERE s.invoice_id = i.id AND s.ocr_detected = true AND s.signed_at IS NOT NULL) as ocr_signed
    FROM "AP_Invoice"."APInvoice_Invoice" i
    WHERE i.status IN ('EXCEPTION_FLAGGED', 'VALIDATION_PENDING', 'RECEIVED', 'OCR_PROCESSING')
      AND EXISTS (
        SELECT 1 FROM "AP_Invoice"."APInvoice_Signature" s 
        WHERE s.invoice_id = i.id AND s.ocr_detected = true AND s.signed_at IS NOT NULL
      )
    ORDER BY i.created_at DESC
    LIMIT 20
  `);

  if (ocrSigned.length > 0) {
    console.log(`\n=== Invoices with OCR-detected signatures but not in approval workflow: ${ocrSigned.length} ===`);
    for (const inv of ocrSigned) {
      console.log(`  ${inv.invoice_number} | ${inv.status} | OCR signatures: ${inv.ocr_signed}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
