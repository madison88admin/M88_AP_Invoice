require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check 260708 details
  const inv = await prisma.invoice.findUnique({
    where: { invoice_number: '260708' },
    include: {
      exceptions: true,
      signatures: true,
      vendor: { select: { name: true } },
      stage_timestamps: { orderBy: { entered_at: 'asc' } },
    },
  });

  if (!inv) {
    console.log('260708 not found');
    return;
  }

  console.log('=== 260708 Details ===');
  console.log('Status:', inv.status);
  console.log('Vendor:', inv.vendor_name_raw, '→ matched:', inv.vendor?.name);
  console.log('Amount:', inv.total_amount, inv.currency);
  console.log('PO:', inv.po_number, 'MPO:', inv.mpo_number);
  console.log('Approval Tier:', inv.approval_tier);
  console.log('Current Approver:', inv.current_approver_role);
  console.log('Signatures:', inv.signatures.map(s => `${s.signatory_name}(${s.signatory_role}, ocr=${s.ocr_detected})`));
  console.log('Exceptions:', inv.exceptions.map(e => `${e.reason}(${e.status})`));
  console.log('Stage History:', inv.stage_timestamps.map(st => `${st.stage}(entered:${st.entered_at}, exited:${st.exited_at})`));

  // If all exceptions are resolved, move it forward
  const pendingExcs = inv.exceptions.filter(e => e.status === 'PENDING');
  if (pendingExcs.length === 0 && inv.status === 'EXCEPTION_FLAGGED') {
    console.log('\nAll exceptions resolved — moving to PENDING_COORDINATOR');
    
    // Check if it has OCR coordinator signature
    const ocrCoord = inv.signatures.find(s => s.ocr_detected && s.signatory_role === 'COORDINATOR');
    
    if (ocrCoord) {
      // Auto-skip coordinator
      console.log(`OCR COORDINATOR signature found (${ocrCoord.signatory_name}) — auto-skipping to PENDING_MANAGER`);
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          status: 'PENDING_MANAGER',
          current_approver_role: 'PURCHASING_MANAGER',
        },
      });
      await prisma.stageTimestamp.create({
        data: {
          invoice_id: inv.id,
          stage: 'PENDING_MANAGER',
          entered_at: new Date(),
          sla_hours: 168,
        },
      });
      await prisma.auditLog.create({
        data: {
          invoice_id: inv.id,
          action: 'AUTO_SIGNED',
          note: `Coordinator auto-skipped: OCR detected signature of ${ocrCoord.signatory_name}. All exceptions resolved. Advanced to PENDING_MANAGER.`,
        },
      });
      console.log('→ Advanced to PENDING_MANAGER');
    } else {
      // Move to PENDING_COORDINATOR
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          status: 'PENDING_COORDINATOR',
          current_approver_role: 'COORDINATOR',
        },
      });
      await prisma.stageTimestamp.create({
        data: {
          invoice_id: inv.id,
          stage: 'PENDING_COORDINATOR',
          entered_at: new Date(),
          sla_hours: 48,
        },
      });
      console.log('→ Advanced to PENDING_COORDINATOR');
    }
  }

  // Also check the 2 remaining PENDING_COORDINATOR invoices
  const stillPending = await prisma.invoice.findMany({
    where: { status: 'PENDING_COORDINATOR' },
    include: { signatures: true, exceptions: true },
  });
  console.log(`\n=== Still PENDING_COORDINATOR (${stillPending.length}) ===`);
  for (const inv of stillPending) {
    const ocrSigs = inv.signatures.filter(s => s.ocr_detected);
    const pendingExcs = inv.exceptions.filter(e => e.status === 'PENDING');
    console.log(`  [${inv.invoice_number}] OCR sigs: ${ocrSigs.length}, Pending excs: ${pendingExcs.length}`);
    console.log(`    Vendor: ${inv.vendor_name_raw}`);
    console.log(`    Signatures: ${inv.signatures.map(s => `${s.signatory_name}(${s.signatory_role},ocr=${s.ocr_detected})`).join(', ')}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
