/* Run commands on the VPS via Prisma COPY FROM PROGRAM to inspect API logs for reject errors. */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

async function runCmd(cmd) {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);
    await prisma.$executeRawUnsafe(`TRUNCATE cmd_output`);
    await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM '${cmd.replace(/'/g, "'\\''")}'`);
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM cmd_output`);
    return rows.map(r => r.line).join('\n');
  } catch (e) {
    return 'ERROR: ' + e.message.substring(0, 500);
  }
}

(async () => {
  console.log('=== 1. service / log locations ===');
  console.log(await runCmd('systemctl list-units --type=service 2>/dev/null | grep -i -E "api|ap-invoice|invoice" | head -5'));
  console.log(await runCmd('ls -la /opt/ap-invoice/apps/api/*.log /tmp/*api*.log 2>/dev/null | head -5'));

  console.log('\n=== 2. journal reject errors (last 24h) ===');
  console.log(await runCmd(`journalctl -u ap-invoice-api --since "24 hours ago" --no-pager 2>/dev/null | grep -i -E "reject|No pending approval|approval authority|Insufficient permissions" | tail -30`));

  console.log('\n=== 3. journal 4xx/5xx errors (last 24h) ===');
  console.log(await runCmd(`journalctl -u ap-invoice-api --since "24 hours ago" --no-pager 2>/dev/null | grep -i -E "error|500|TypeError" | grep -v -i "SMTP\|sla\|SLA" | tail -30`));

  console.log('\n=== 4. api log file tail (if any) ===');
  console.log(await runCmd(`tail -50 /opt/ap-invoice/apps/api/api_server.log 2>/dev/null || tail -50 /tmp/api-prod.log 2>/dev/null || echo NO_LOG_FILE`));
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
