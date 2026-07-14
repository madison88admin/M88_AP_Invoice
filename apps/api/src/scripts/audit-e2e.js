require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== END-TO-END SYSTEM AUDIT ===\n');

  // 1. INVOICES
  const invoices = await prisma.invoice.findMany({
    orderBy: { created_at: 'desc' },
    take: 20,
    include: {
      signatures: { where: { ocr_detected: true } },
      exceptions: true,
      vendor: { select: { name: true, supplier_location: true } },
      stage_timestamps: { orderBy: { entered_at: 'asc' } },
    },
  });

  console.log(`--- INVOICES (${invoices.length}) ---`);
  for (const inv of invoices) {
    console.log(`\n  [${inv.invoice_number}] (${inv.status})`);
    console.log(`    Vendor: ${inv.vendor_name_raw} → matched: ${inv.vendor?.name || 'NONE'}`);
    console.log(`    Amount: ${inv.total_amount} ${inv.currency || ''}`);
    console.log(`    OCR Engine: ${inv.ocr_engine}, Confidence: ${inv.ocr_confidence}`);
    console.log(`    PO: ${inv.po_number || 'none'}, MPO: ${inv.mpo_number || 'none'}`);
    console.log(`    Approval Tier: ${inv.approval_tier || 'none'}`);
    console.log(`    Source: ${inv.source}, Created: ${inv.created_at?.toISOString()}`);
    console.log(`    OCR Signatures: ${inv.signatures.length} → ${inv.signatures.map(s => `${s.signatory_name}(${s.signatory_role})`).join(', ') || 'none'}`);
    console.log(`    Exceptions: ${inv.exceptions.length} → ${inv.exceptions.map(e => `${e.reason}(${e.status})`).join(', ') || 'none'}`);
    
    if (inv.stage_timestamps.length > 0) {
      console.log(`    Stage History:`);
      for (const st of inv.stage_timestamps) {
        console.log(`      ${st.stage} → entered: ${st.entered_at?.toISOString() || 'N/A'}, exited: ${st.exited_at?.toISOString() || 'pending'}`);
      }
    }
    
    console.log(`    Current Approver Role: ${inv.current_approver_role || 'none'}`);
  }

  // 2. APPROVAL-RELATED INFO (tracked via invoice.status + current_approver_role)
  const pendingApproval = await prisma.invoice.findMany({
    where: { status: { in: ['PENDING_COORDINATOR', 'PENDING_MANAGER', 'PENDING_MLO_ACCOUNT_HOLDER', 'PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER', 'PENDING_POLLY', 'PENDING_ACCOUNTING'] } },
    select: { invoice_number: true, status: true, current_approver_role: true, approval_tier: true },
    orderBy: { created_at: 'desc' },
  });
  console.log(`\n\n--- PENDING APPROVALS (${pendingApproval.length}) ---`);
  for (const inv of pendingApproval) {
    console.log(`  ${inv.invoice_number}: ${inv.status} → approver: ${inv.current_approver_role || 'none'}, tier: ${inv.approval_tier}`);
  }

  // 3. SIGNATURES SUMMARY
  const sigCount = await prisma.signature.count({ where: { ocr_detected: true } });
  const sigByRole = await prisma.signature.groupBy({
    by: ['signatory_role'],
    where: { ocr_detected: true },
    _count: true,
  });
  console.log(`\n\n--- SIGNATURES ---`);
  console.log(`  Total OCR-detected: ${sigCount}`);
  console.log(`  By role:`, JSON.stringify(sigByRole));

  // 4. EXCEPTIONS SUMMARY
  const excCount = await prisma.exception.count();
  const excByStatus = await prisma.exception.groupBy({
    by: ['status'],
    _count: true,
  });
  console.log(`\n--- EXCEPTIONS ---`);
  console.log(`  Total: ${excCount}`);
  console.log(`  By status:`, JSON.stringify(excByStatus));

  // 5. PAYMENTS & BATCHES
  const payments = await prisma.payment.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: { invoice: { select: { invoice_number: true, status: true } } },
  });
  const batches = await prisma.paymentBatch.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: { _count: { select: { payments: true } } },
  });
  console.log(`\n--- PAYMENTS (${payments.length}) ---`);
  for (const p of payments) {
    console.log(`  ${p.invoice.invoice_number}: ${p.amount} ${p.currency} — ${p.status} — ${p.payment_date?.toISOString()}`);
  }
  console.log(`\n--- PAYMENT BATCHES (${batches.length}) ---`);
  for (const b of batches) {
    console.log(`  ${b.batch_number}: ${b.total_amount} ${b.currency} — ${b.status} — ${b._count.payments} payments`);
  }

  // 6. STATUS DISTRIBUTION
  const statusCounts = await prisma.invoice.groupBy({
    by: ['status'],
    _count: true,
    orderBy: { _count: { status: 'desc' } },
  });
  console.log(`\n--- INVOICE STATUS DISTRIBUTION ---`);
  for (const s of statusCounts) {
    console.log(`  ${s.status}: ${s._count.status}`);
  }

  // 7. FILE WATCHER DIRS
  const fs = require('fs');
  const dirs = ['/incoming-invoices', '/incoming-invoices/processing', '/incoming-invoices/processed', '/incoming-invoices/manual-review', '/incoming-invoices/duplicates', '/incoming-invoices/failed'];
  console.log(`\n--- FILE WATCHER DIRECTORIES ---`);
  for (const d of dirs) {
    try {
      const files = fs.readdirSync(d);
      console.log(`  ${d}: ${files.length} files → ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
    } catch {
      console.log(`  ${d}: NOT FOUND`);
    }
  }

  console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error).finally(() => prisma.$disconnect());
