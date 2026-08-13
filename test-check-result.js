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
    return 'ERROR: ' + e.message.substring(0, 300);
  }
}

(async () => {
  try {
    // Check the result file
    console.log('1. Check SSH result...');
    console.log(await runCmd('cat /tmp/ssh_result.txt 2>/dev/null || echo "no result file"'));
    console.log(await runCmd('ls -la /tmp/ssh_result.txt 2>/dev/null || echo "no file"'));
    
    // Check if there's a python process still running
    console.log('\n2. Check processes...');
    console.log(await runCmd('ps aux 2>/dev/null | grep python || echo "no ps"'));
    
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
