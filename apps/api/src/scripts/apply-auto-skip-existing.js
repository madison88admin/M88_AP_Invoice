/**
 * Migration script: Apply auto-skip logic to existing invoices in the approval workflow.
 * 
 * For each invoice currently pending approval (PENDING_COORDINATOR, PENDING_MANAGER, etc.):
 * 1. Check if there are OCR-detected signatures on the document matching the pending approver's role
 * 2. If so, auto-sign those approval steps
 * 3. Advance the invoice to the next unsigned approver (or Accounting if all signed)
 * 
 * Usage: node dist/scripts/apply-auto-skip-existing.js
 */

require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Import shared utilities
const {
  InvoiceStatus,
  SignatoryRole,
  SignatureType,
  determineApprovalTier,
  mapSignatoryRoleToPendingStatus,
  matchSignerToRole,
  SLA_LIMITS,
  COORDINATOR_NAMES,
  PURCHASING_MANAGER_NAMES,
  MLO_ACCOUNT_HOLDER_EDWIN,
  MLO_ACCOUNT_HOLDER_GLECIE,
  APPROVAL_THRESHOLDS,
} = require('@ap-invoice/shared');

// Pending approval statuses (invoices in the approval workflow)
const PENDING_STATUSES = [
  'PENDING_COORDINATOR',
  'PENDING_MANAGER',
  'PENDING_MLO_ACCOUNT_HOLDER',
  'PENDING_MLO_PLANNING_MANAGER',
  'PENDING_SR_MANAGER',
  'PENDING_POLLY',
];

// Map status back to signatory role
function mapStatusToRole(status) {
  const mapping = {
    'PENDING_COORDINATOR': SignatoryRole.COORDINATOR,
    'PENDING_MANAGER': SignatoryRole.PURCHASING_MANAGER,
    'PENDING_MLO_ACCOUNT_HOLDER': SignatoryRole.MLO_ACCOUNT_HOLDER,
    'PENDING_MLO_PLANNING_MANAGER': SignatoryRole.MLO_PLANNING_MANAGER,
    'PENDING_SR_MANAGER': SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION,
    'PENDING_POLLY': SignatoryRole.MS_POLLY,
  };
  return mapping[status] || null;
}

// Determine approval route (simplified version matching approvalService)
function determineApprovalRoute(amount, brandName, brandCode) {
  const tier = determineApprovalTier(amount);

  if (tier === 1) {
    return [
      { role: SignatoryRole.COORDINATOR, assignee_name: 'Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS },
      { role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS },
    ];
  }

  if (tier === 2) {
    return [
      { role: SignatoryRole.COORDINATOR, assignee_name: 'Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS },
      { role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS },
      { role: SignatoryRole.MLO_ACCOUNT_HOLDER, assignee_name: 'MLO Account Holder', sla_days: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS },
      { role: SignatoryRole.MLO_PLANNING_MANAGER, assignee_name: 'MLO Planning Manager', sla_days: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS },
      { role: SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION, assignee_name: 'Sr. Manager', sla_days: SLA_LIMITS.SR_MANAGER_DAYS },
    ];
  }

  // Tier 3
  return [
    { role: SignatoryRole.COORDINATOR, assignee_name: 'Coordinator', sla_days: SLA_LIMITS.COORDINATOR_DAYS },
    { role: SignatoryRole.PURCHASING_MANAGER, assignee_name: 'Purchasing Manager', sla_days: SLA_LIMITS.PURCHASING_MANAGER_DAYS },
    { role: SignatoryRole.MLO_ACCOUNT_HOLDER, assignee_name: 'MLO Account Holder', sla_days: SLA_LIMITS.MLO_ACCOUNT_HOLDER_DAYS },
    { role: SignatoryRole.MLO_PLANNING_MANAGER, assignee_name: 'MLO Planning Manager', sla_days: SLA_LIMITS.MLO_PLANNING_MANAGER_DAYS },
    { role: SignatoryRole.SR_MANAGER_GLOBAL_PRODUCTION, assignee_name: 'Sr. Manager', sla_days: SLA_LIMITS.SR_MANAGER_DAYS },
    { role: SignatoryRole.MS_POLLY, assignee_name: 'Ms. Polly', sla_days: SLA_LIMITS.MS_POLLY_DAYS },
  ];
}

async function main() {
  console.log('=== Apply Auto-Skip to Existing Invoices ===\n');

  // Find all invoices in pending approval statuses
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: PENDING_STATUSES },
    },
    include: {
      signatures: true,
      vendor: true,
      stage_timestamps: true,
    },
  });

  console.log(`Found ${invoices.length} invoices in pending approval status\n`);

  let skipped = 0;
  let advanced = 0;
  let noChange = 0;

  for (const invoice of invoices) {
    const amount = Number(invoice.total_amount);
    console.log(`\n--- Invoice ${invoice.invoice_number} (ID: ${invoice.id}) ---`);
    console.log(`  Status: ${invoice.status}, Amount: $${amount.toFixed(2)}, Tier: ${invoice.approval_tier || 'N/A'}`);

    // Get OCR-detected signatures (from document)
    const ocrSignatures = (invoice.signatures || []).filter(
      (sig) => sig.ocr_detected && sig.signed_at
    );

    if (ocrSignatures.length === 0) {
      console.log('  No OCR-detected signatures on document — skipping');
      noChange++;
      continue;
    }

    console.log(`  OCR signatures found: ${ocrSignatures.map(s => `${s.signatory_name} (${s.signatory_role})`).join(', ')}`);

    // Determine the approval route
    let approvalRoute;
    try {
      approvalRoute = determineApprovalRoute(amount, invoice.brand || undefined, invoice.brand_code || undefined);
    } catch (e) {
      console.log(`  Could not determine approval route: ${e.message} — skipping`);
      noChange++;
      continue;
    }

    // Find unsigned approval signatures (non-OCR ones created by createApprovalRequest)
    const approvalSignatures = (invoice.signatures || []).filter(
      (sig) => !sig.ocr_detected
    );

    const unsignedSignatures = approvalSignatures.filter((sig) => !sig.signed_at);

    if (unsignedSignatures.length === 0) {
      console.log('  No unsigned approval signatures — skipping');
      noChange++;
      continue;
    }

    console.log(`  Unsigned approval steps: ${unsignedSignatures.map(s => s.signatory_role).join(', ')}`);

    // For each unsigned signature, check if there's a matching OCR-detected signature
    let autoSignedCount = 0;
    const now = new Date();

    for (const unsignedSig of unsignedSignatures) {
      const ocrMatch = ocrSignatures.find((sig) => {
        if (sig.signatory_role === unsignedSig.signatory_role) return true;
        const roleFromName = matchSignerToRole(sig.signatory_name);
        return roleFromName === unsignedSig.signatory_role;
      });

      if (ocrMatch) {
        console.log(`  Auto-signing ${unsignedSig.signatory_role} with "${ocrMatch.signatory_name}" (from document signature)`);
        
        await prisma.signature.update({
          where: { id: unsignedSig.id },
          data: {
            signatory_name: ocrMatch.signatory_name,
            signed_at: ocrMatch.signed_at,
            signature_type: 'DIGITAL',
          },
        });

        // Exit the current stage timestamp for this role
        const stageStatus = mapSignatoryRoleToPendingStatus(unsignedSig.signatory_role);
        const stage = invoice.stage_timestamps?.find(
          (st) => st.stage === stageStatus && !st.exited_at
        );
        if (stage) {
          await prisma.stage_timestamp.update({
            where: { id: stage.id },
            data: {
              exited_at: now,
              is_breached: false,
            },
          });
        }

        autoSignedCount++;
      }
    }

    if (autoSignedCount === 0) {
      console.log('  No matching OCR signatures for unsigned steps — no change');
      noChange++;
      continue;
    }

    console.log(`  Auto-signed ${autoSignedCount} step(s)`);

    // Re-fetch signatures to find remaining unsigned
    const updatedSignatures = await prisma.signature.findMany({
      where: { invoice_id: invoice.id },
      orderBy: { created_at: 'asc' },
    });

    const remainingUnsigned = updatedSignatures.filter((sig) => !sig.signed_at && !sig.ocr_detected);

    if (remainingUnsigned.length === 0) {
      // All signed — advance to Accounting
      console.log('  All approvers signed — advancing to PENDING_ACCOUNTING');
      
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PENDING_ACCOUNTING',
          current_approver_role: null,
        },
      });

      // Create Accounting stage timestamp
      await prisma.stage_timestamp.create({
        data: {
          invoice_id: invoice.id,
          stage: 'PENDING_ACCOUNTING',
          entered_at: new Date(),
          sla_hours: SLA_LIMITS.ACCOUNTING_DAYS * 24,
        },
      });

      await prisma.audit_log.create({
        data: {
          invoice_id: invoice.id,
          action: 'AUTO_SIGNED_MIGRATION',
          performed_by: 'system',
          note: `Migration: Auto-signed ${autoSignedCount} step(s) from document signatures. All approvers signed — advanced to Accounting.`,
        },
      });

      advanced++;
    } else {
      // Advance to the first remaining unsigned approver
      const nextSig = remainingUnsigned[0];
      const nextStatus = mapSignatoryRoleToPendingStatus(nextSig.signatory_role);
      
      console.log(`  Advancing to ${nextStatus} (next approver: ${nextSig.signatory_role})`);

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: nextStatus,
          current_approver_role: nextSig.signatory_role,
        },
      });

      // Create stage timestamp for the new current stage
      const nextStep = approvalRoute.find((s) => s.role === nextSig.signatory_role);
      await prisma.stage_timestamp.create({
        data: {
          invoice_id: invoice.id,
          stage: nextStatus,
          entered_at: new Date(),
          sla_hours: (nextStep?.sla_days || 7) * 24,
        },
      });

      await prisma.audit_log.create({
        data: {
          invoice_id: invoice.id,
          action: 'AUTO_SIGNED_MIGRATION',
          performed_by: 'system',
          note: `Migration: Auto-signed ${autoSignedCount} step(s) from document signatures. Advanced to ${nextStatus} (next: ${nextSig.signatory_role}).`,
        },
      });

      advanced++;
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Total invoices processed: ${invoices.length}`);
  console.log(`Invoices advanced/skipped: ${advanced}`);
  console.log(`Invoices with no change: ${noChange}`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
