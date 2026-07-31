// Update SLA hours for existing stage timestamps in PENDING_MLO_ACCOUNT_HOLDER, PENDING_MLO_PLANNING_MANAGER, PENDING_SR_MANAGER
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load .env
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('Loaded env from:', envPath);
    break;
  }
}

const prisma = new PrismaClient();

async function main() {
  const updates = [
    { stage: 'PENDING_MLO_ACCOUNT_HOLDER', sla_hours: 48 },
    { stage: 'PENDING_MLO_PLANNING_MANAGER', sla_hours: 48 },
    { stage: 'PENDING_SR_MANAGER', sla_hours: 72 },
  ];

  for (const u of updates) {
    // Update active stage timestamps (no exited_at)
    const active = await prisma.stageTimestamp.updateMany({
      where: { stage: u.stage, exited_at: null },
      data: { sla_hours: u.sla_hours },
    });
    console.log(`${u.stage}: updated ${active.count} active stage timestamps to ${u.sla_hours}h (${u.sla_hours/24} days)`);

    // Also update historical ones for consistency
    const historical = await prisma.stageTimestamp.updateMany({
      where: { stage: u.stage, exited_at: { not: null } },
      data: { sla_hours: u.sla_hours },
    });
    console.log(`  (also updated ${historical.count} historical stage timestamps)`);
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
