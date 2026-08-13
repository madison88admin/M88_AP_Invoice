process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

async function runCmd(cmd) {
  try {
    await prisma.$executeRawUnsafe(`TRUNCATE cmd_output`);
    await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM '${cmd.replace(/'/g, "'\\''")}'`);
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM cmd_output`);
    return rows.map(r => r.line).join('\n');
  } catch (e) {
    return 'ERROR: ' + e.message.substring(0, 200);
  }
}

(async () => {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);

    console.log('1. Find API directory...');
    console.log(await runCmd('find / -name "invoiceService.ts" -o -name "invoiceService.js" 2>/dev/null | head -10'));

    console.log('\n2. Check common locations...');
    console.log(await runCmd('ls -la /opt/ 2>/dev/null'));
    console.log(await runCmd('ls -la /home/ 2>/dev/null'));
    console.log(await runCmd('ls -la /srv/ 2>/dev/null'));
    console.log(await runCmd('ls -la /var/www/ 2>/dev/null'));

    console.log('\n3. Find PM2/systemd services...');
    console.log(await runCmd('which pm2 2>/dev/null && pm2 list 2>/dev/null || echo "no pm2"'));
    console.log(await runCmd('systemctl list-units --type=service | grep -i "invoice\\|api\\|ap" 2>/dev/null | head -10'));

    console.log('\n4. Find node processes...');
    console.log(await runCmd('ps aux | grep -i "node\\|pm2" | grep -v grep | head -10'));

    console.log('\n5. Find git repos...');
    console.log(await runCmd('find / -name ".git" -type d 2>/dev/null | head -10'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
