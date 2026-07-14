require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find invoices at PENDING_COORDINATOR that have OCR-detected COORDINATOR signatures
  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'PENDING_COORDINATOR',
      signatures: {
        some: {
          ocr_detected: true,
          signatory_role: 'COORDINATOR',
        },
      },
    },
    include: {
      signatures: true,
      vendor: { select: { name: true } },
      stage_timestamps: { orderBy: { entered_at: 'asc' } },
    },
  });

  console.log(`Found ${invoices.length} invoices at PENDING_COORDINATOR with OCR COORDINATOR signatures\n`);

  for (const inv of invoices) {
    const ocrCoordSig = inv.signatures.find(s => s.ocr_detected && s.signatory_role === 'COORDINATOR');
    if (!ocrCoordSig) continue;

    console.log(`[${inv.invoice_number}] Auto-skipping COORDINATOR (signed by ${ocrCoordSig.signatory_name})`);

    // 1. Exit the PENDING_COORDINATOR stage
    await prisma.stageTimestamp.updateMany({
      where: {
        invoice_id: inv.id,
        stage: 'PENDING_COORDINATOR',
        exited_at: null,
      },
      data: { exited_at: new Date() },
    });

    // 2. Update invoice status to PENDING_MANAGER
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        status: 'PENDING_MANAGER',
        current_approver_role: 'PURCHASING_MANAGER',
      },
    });

    // 3. Create PENDING_MANAGER stage timestamp
    await prisma.stageTimestamp.create({
      data: {
        invoice_id: inv.id,
        stage: 'PENDING_MANAGER',
        entered_at: new Date(),
        sla_hours: 168, // 7 days
      },
    });

    // 4. Create audit log
    await prisma.auditLog.create({
      data: {
        invoice_id: inv.id,
        action: 'AUTO_SIGNED',
        performed_by: null,
        note: `Coordinator auto-skipped: OCR detected signature of ${ocrCoordSig.signatory_name} on document. Advanced to PENDING_MANAGER.`,
      },
    });

    console.log(`  → Advanced to PENDING_MANAGER`);
  }

  // Also check for invoices at EXCEPTION_FLAGGED with OCR signatures
  const excInvoices = await prisma.invoice.findMany({
    where: {
      status: 'EXCEPTION_FLAGGED',
      signatures: {
        some: { ocr_detected: true },
      },
    },
    include: {
      signatures: { where: { ocr_detected: true } },
      exceptions: true,
    },
  });

  console.log(`\n--- EXCEPTION_FLAGGED with OCR signatures (${excInvoices.length}) ---`);
  for (const inv of excInvoices) {
    const pendingExcs = inv.exceptions.filter(e => e.status === 'PENDING');
    console.log(`  [${inv.invoice_number}]: ${inv.signatures.length} OCR sigs, ${pendingExcs.length} pending exceptions`);
    for (const exc of pendingExcs) {
      console.log(`    ${exc.reason}: ${exc.detail || 'no detail'}`);
    }
  }

  // Summary
  const stillPending = await prisma.invoice.count({ where: { status: 'PENDING_COORDINATOR' } });
  const nowPendingMgr = await prisma.invoice.count({ where: { status: 'PENDING_MANAGER' } });
  console.log(`\n--- SUMMARY ---`);
  console.log(`  Still PENDING_COORDINATOR: ${stillPending}`);
  console.log(`  Now PENDING_MANAGER: ${nowPendingMgr}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
