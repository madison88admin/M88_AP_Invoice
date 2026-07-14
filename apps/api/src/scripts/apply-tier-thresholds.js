require('dotenv').config({ path: __dirname + '/../../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Tier thresholds — roles above this amount only
const ROLE_TIER_THRESHOLD = {
  MLO_ACCOUNT_HOLDER: 2000,
  PLANNING_MANAGER: 2000,
  SR_MANAGER_GLOBAL_PRODUCTION: 2000,
  MS_POLLY: 100000,
};

// Map pending status → the role that should be approving at that stage
const STATUS_TO_ROLE = {
  PENDING_MLO_ACCOUNT_HOLDER: 'MLO_ACCOUNT_HOLDER',
  PENDING_MLO_PLANNING_MANAGER: 'PLANNING_MANAGER',
  PENDING_SR_MANAGER: 'SR_MANAGER_GLOBAL_PRODUCTION',
  PENDING_POLLY: 'MS_POLLY',
};

// Map status → the previous stage to roll back to
const STATUS_PREV = {
  PENDING_MLO_ACCOUNT_HOLDER: 'PENDING_MANAGER',
  PENDING_MLO_PLANNING_MANAGER: 'PENDING_MLO_ACCOUNT_HOLDER',
  PENDING_SR_MANAGER: 'PENDING_MLO_PLANNING_MANAGER',
  PENDING_POLLY: 'PENDING_SR_MANAGER',
};

// Map status → approver role for current_approver_role field
const STATUS_TO_APPROVER = {
  PENDING_COORDINATOR: 'COORDINATOR',
  PENDING_MANAGER: 'PURCHASING_MANAGER',
  PENDING_MLO_ACCOUNT_HOLDER: 'MLO_ACCOUNT_HOLDER',
  PENDING_MLO_PLANNING_MANAGER: 'MLO_PLANNING_MANAGER',
  PENDING_SR_MANAGER: 'SR_MANAGER_GLOBAL_PRODUCTION',
  PENDING_POLLY: 'MS_POLLY',
  PENDING_ACCOUNTING: 'ACCOUNTING_REVIEWER',
};

async function main() {
  console.log('=== APPLY TIER THRESHOLDS TO EXISTING INVOICES ===\n');

  // Find all invoices at tier-restricted stages
  const tieredStatuses = Object.keys(STATUS_TO_ROLE);
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: tieredStatuses },
    },
    include: {
      signatures: { orderBy: { created_at: 'asc' } },
      vendor: { select: { name: true } },
      stage_timestamps: { orderBy: { entered_at: 'asc' } },
    },
  });

  console.log(`Found ${invoices.length} invoices at tier-restricted stages\n`);

  let fixed = 0;
  let skipped = 0;

  for (const inv of invoices) {
    const amount = Number(inv.total_amount);
    const role = STATUS_TO_ROLE[inv.status];
    const threshold = ROLE_TIER_THRESHOLD[role];

    if (amount <= threshold) {
      console.log(`[FIX] ${inv.invoice_number}: $${amount} at ${inv.status} (threshold: >$${threshold})`);
      console.log(`  Vendor: ${inv.vendor?.name || inv.vendor_name_raw}`);
      console.log(`  Approval Tier: ${inv.approval_tier}`);

      // Find the first unsigned signature at or after the current stage
      // The invoice should not be at this stage — it needs to be moved forward
      // since the approval route shouldn't have included this step for Tier 1

      // Check if all signatures up to the current stage are signed
      const unsignedAtCurrent = inv.signatures.find(s =>
        !s.signed_at &&
        (s.signatory_role === role ||
         (inv.status === 'PENDING_MLO_PLANNING_MANAGER' && s.signatory_role === 'MLO_PLANNING_MANAGER'))
      );

      // The invoice was incorrectly routed to this tier-restricted stage.
      // Auto-skip it: mark the signature as auto-signed and advance to the next stage.
      
      // 1. Auto-sign the current stage's signature(s)
      const rolesToSign = [];
      if (inv.status === 'PENDING_MLO_ACCOUNT_HOLDER') {
        rolesToSign.push('MLO_ACCOUNT_HOLDER');
      } else if (inv.status === 'PENDING_MLO_PLANNING_MANAGER') {
        rolesToSign.push('MLO_PLANNING_MANAGER');
      } else if (inv.status === 'PENDING_SR_MANAGER') {
        rolesToSign.push('SR_MANAGER_GLOBAL_PRODUCTION');
      } else if (inv.status === 'PENDING_POLLY') {
        rolesToSign.push('MS_POLLY');
      }

      const now = new Date();

      for (const roleToSign of rolesToSign) {
        const unsignedSig = inv.signatures.find(s =>
          !s.signed_at && s.signatory_role === roleToSign
        );
        if (unsignedSig) {
          await prisma.signature.update({
            where: { id: unsignedSig.id },
            data: {
              signed_at: now,
              signatory_name: 'AUTO-SKIPPED (below tier threshold)',
            },
          });
          console.log(`  → Auto-signed: ${roleToSign}`);
        }
      }

      // 2. Exit the current stage
      await prisma.stageTimestamp.updateMany({
        where: {
          invoice_id: inv.id,
          stage: inv.status,
          exited_at: null,
        },
        data: { exited_at: now },
      });

      // 3. Determine the next stage
      // For Tier 1 invoices, after PM the next is PENDING_ACCOUNTING
      // For Tier 2 invoices incorrectly at PENDING_SR_MANAGER or PENDING_POLLY, skip to PENDING_ACCOUNTING
      const tier = inv.approval_tier || 1;
      let nextStatus;

      if (inv.status === 'PENDING_MLO_ACCOUNT_HOLDER') {
        // Check if MLO_PLANNING_MANAGER and SR_MANAGER are also in the route
        // For Tier 1, skip directly to ACCOUNTING
        if (tier <= 1) {
          nextStatus = 'PENDING_ACCOUNTING';
        } else {
          // Tier 2+ — but amount is below threshold? This shouldn't happen.
          // Still, advance to next stage
          nextStatus = 'PENDING_MLO_PLANNING_MANAGER';
        }
      } else if (inv.status === 'PENDING_MLO_PLANNING_MANAGER') {
        if (tier <= 1) {
          nextStatus = 'PENDING_ACCOUNTING';
        } else {
          nextStatus = 'PENDING_SR_MANAGER';
        }
      } else if (inv.status === 'PENDING_SR_MANAGER') {
        if (tier <= 2) {
          nextStatus = 'PENDING_ACCOUNTING';
        } else {
          nextStatus = 'PENDING_POLLY';
        }
      } else if (inv.status === 'PENDING_POLLY') {
        nextStatus = 'PENDING_ACCOUNTING';
      } else {
        nextStatus = 'PENDING_ACCOUNTING';
      }

      // 4. Also auto-sign any remaining tier-restricted signatures between current and next
      const remainingRoles = [];
      if (inv.status === 'PENDING_MLO_ACCOUNT_HOLDER' && nextStatus === 'PENDING_ACCOUNTING') {
        remainingRoles.push('MLO_PLANNING_MANAGER', 'SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY');
      } else if (inv.status === 'PENDING_MLO_PLANNING_MANAGER' && nextStatus === 'PENDING_ACCOUNTING') {
        remainingRoles.push('SR_MANAGER_GLOBAL_PRODUCTION', 'MS_POLLY');
      } else if (inv.status === 'PENDING_SR_MANAGER' && nextStatus === 'PENDING_ACCOUNTING') {
        remainingRoles.push('MS_POLLY');
      }

      for (const remRole of remainingRoles) {
        const remSig = inv.signatures.find(s =>
          !s.signed_at && s.signatory_role === remRole
        );
        if (remSig) {
          await prisma.signature.update({
            where: { id: remSig.id },
            data: {
              signed_at: now,
              signatory_name: 'AUTO-SKIPPED (below tier threshold)',
            },
          });
          console.log(`  → Auto-signed: ${remRole}`);
        }
      }

      // 5. Create stage timestamp for skipped stages (for SLA records)
      const skippedStages = [];
      if (inv.status === 'PENDING_MLO_ACCOUNT_HOLDER' && nextStatus === 'PENDING_ACCOUNTING') {
        skippedStages.push('PENDING_MLO_PLANNING_MANAGER', 'PENDING_SR_MANAGER');
      } else if (inv.status === 'PENDING_MLO_PLANNING_MANAGER' && nextStatus === 'PENDING_ACCOUNTING') {
        skippedStages.push('PENDING_SR_MANAGER');
      }

      for (const stage of skippedStages) {
        await prisma.stageTimestamp.create({
          data: {
            invoice_id: inv.id,
            stage: stage,
            entered_at: now,
            exited_at: now,
            sla_hours: 0,
            is_breached: false,
          },
        });
      }

      // 6. Update invoice status
      const nextApprover = STATUS_TO_APPROVER[nextStatus] || null;
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          status: nextStatus,
          current_approver_role: nextApprover,
        },
      });

      // 7. Create stage timestamp for the new stage
      const slaMap = {
        PENDING_ACCOUNTING: 168, // 7 days
        PENDING_MLO_PLANNING_MANAGER: 96, // 4 days
        PENDING_SR_MANAGER: 168, // 7 days
        PENDING_POLLY: 168, // 7 days
      };

      await prisma.stageTimestamp.create({
        data: {
          invoice_id: inv.id,
          stage: nextStatus,
          entered_at: now,
          sla_hours: slaMap[nextStatus] || 168,
        },
      });

      // 8. Audit log
      await prisma.auditLog.create({
        data: {
          invoice_id: inv.id,
          action: 'TIER_THRESHOLD_SKIP',
          note: `Invoice $${amount} is below ${role} threshold (>$${threshold}). Auto-skipped ${inv.status} → ${nextStatus}. Tier: ${tier}.`,
        },
      });

      console.log(`  → Advanced to ${nextStatus}\n`);
      fixed++;
    } else {
      console.log(`[OK] ${inv.invoice_number}: $${amount} at ${inv.status} (threshold: >$${threshold}) — above threshold`);
      skipped++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Fixed (auto-skipped): ${fixed}`);
  console.log(`  OK (above threshold): ${skipped}`);
  console.log(`  Total checked: ${invoices.length}`);

  // Show current status distribution
  const statusCounts = await prisma.invoice.groupBy({
    by: ['status'],
    _count: true,
    orderBy: { _count: { status: 'desc' } },
  });
  console.log(`\n--- UPDATED STATUS DISTRIBUTION ---`);
  for (const s of statusCounts) {
    console.log(`  ${s.status}: ${s._count.status}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
