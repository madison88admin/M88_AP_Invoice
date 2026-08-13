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

    console.log('1. Check if in container...');
    console.log(await runCmd('cat /proc/1/cgroup 2>/dev/null | head -5'));
    console.log(await runCmd('cat /.dockerenv 2>/dev/null || echo "no dockerenv"'));
    console.log(await runCmd('hostname'));

    console.log('\n2. Check filesystem...');
    console.log(await runCmd('ls -la / 2>/dev/null'));
    console.log(await runCmd('df -h 2>/dev/null | head -10'));

    console.log('\n3. Check network...');
    console.log(await runCmd('ip addr show 2>/dev/null | grep "inet " | head -5'));
    console.log(await runCmd('cat /etc/hosts 2>/dev/null | head -10'));

    console.log('\n4. Try to reach the API from inside...');
    console.log(await runCmd('curl -s http://localhost:3001/api/health 2>/dev/null || echo "cannot reach localhost:3001"'));
    console.log(await runCmd('curl -s http://5.223.78.194/api/health 2>/dev/null || echo "cannot reach 5.223.78.194:80"'));

    console.log('\n5. Check if we can access the host...');
    console.log(await runCmd('ls -la /host 2>/dev/null || echo "no /host"'));
    console.log(await runCmd('ls -la /mnt 2>/dev/null || echo "no /mnt"'));

    console.log('\n6. Check what tools are available...');
    console.log(await runCmd('which curl wget git node npm npx pnpm 2>/dev/null || echo "checking individually"'));
    console.log(await runCmd('which curl 2>/dev/null || echo "no curl"'));
    console.log(await runCmd('which wget 2>/dev/null || echo "no wget"'));
    console.log(await runCmd('which git 2>/dev/null || echo "no git"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
