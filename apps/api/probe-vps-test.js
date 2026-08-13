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
  console.log('=== whoami ===');
  console.log(await runCmd('whoami'));
  console.log('\n=== hostname ===');
  console.log(await runCmd('hostname'));
  console.log('\n=== ps api ===');
  console.log(await runCmd('ps aux | grep -E "node.*dist/index" | grep -v grep | head -3'));
  console.log('\n=== systemd units ===');
  console.log(await runCmd('systemctl list-units --no-pager 2>/dev/null | grep -iE "ap|invoice|api|ocr" | head -10'));
  console.log('\n=== /opt listing ===');
  console.log(await runCmd('ls /opt/ 2>/dev/null | head'));
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
