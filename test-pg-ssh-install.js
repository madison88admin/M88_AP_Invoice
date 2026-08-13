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

    // Find the host gateway IP
    console.log('1. Find host gateway...');
    console.log(await runCmd('cat /proc/net/route 2>/dev/null'));
    console.log(await runCmd('cat /etc/hosts 2>/dev/null | grep -v "^#" | grep -v "^$"'));
    
    // Try common gateway IPs
    console.log('\n2. Try to reach SSH on host...');
    const gateways = ['172.17.0.1', '172.18.0.1', '172.19.0.1', '172.20.0.1', '10.0.0.1', 'host.docker.internal'];
    for (const gw of gateways) {
      const result = await runCmd(`curl -s --connect-timeout 2 telnet://${gw}:22 2>&1 | head -1 || echo "no SSH on ${gw}"`);
      console.log(`   ${gw}:22 -> ${result}`);
    }

    // Check if ssh client is available in the container
    console.log('\n3. Check SSH client...');
    console.log(await runCmd('which ssh sshpass 2>/dev/null || echo "no ssh client"'));
    console.log(await runCmd('apt list --installed 2>/dev/null | grep ssh || echo "no ssh packages"'));

    // Try to install ssh
    console.log('\n4. Try to install ssh client...');
    console.log(await runCmd('apt-get update -qq 2>&1 | tail -3 && apt-get install -y -qq openssh-client sshpass 2>&1 | tail -5 || echo "cannot install"'));

    // Check again
    console.log('\n5. Check SSH client again...');
    console.log(await runCmd('which ssh sshpass 2>/dev/null || echo "still no ssh"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
