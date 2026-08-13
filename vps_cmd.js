process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
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
  try {
    console.log('=== AM I IN DOCKER ===');
    console.log(await runCmd('cat /proc/1/cgroup 2>/dev/null | head -5'));
    console.log(await runCmd('ls /.dockerenv 2>/dev/null && echo IN_DOCKER || echo NOT_DOCKER'));
    console.log('\n=== HOSTNAME ===');
    console.log(await runCmd('hostname'));
    console.log('\n=== /proc/1/cmdline ===');
    console.log(await runCmd('cat /proc/1/cmdline 2>/dev/null | tr "\\0" " "'));
    console.log('\n=== NGINX ===');
    console.log(await runCmd('which nginx 2>/dev/null && nginx -t 2>&1 || echo NO_NGINX'));
    console.log('\n=== TRY CURL localhost:3001 ===');
    console.log(await runCmd('curl -s -m 5 http://localhost:3001/api/health 2>&1 || echo CURL_FAIL'));
    console.log('\n=== TRY CURL localhost:80 ===');
    console.log(await runCmd('curl -s -m 5 http://localhost:80/api/health 2>&1 || echo CURL_FAIL'));
    console.log('\n=== /var/www ===');
    console.log(await runCmd('ls /var/www/ 2>/dev/null || echo NO_WWW'));
    console.log('\n=== /srv ===');
    console.log(await runCmd('ls /srv/ 2>/dev/null || echo NO_SRV'));
    console.log('\n=== /app ===');
    console.log(await runCmd('ls /app/ 2>/dev/null || echo NO_APP'));
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
