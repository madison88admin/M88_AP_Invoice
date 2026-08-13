process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });
const fs = require('fs');

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

async function writeFileB64(path, content) {
  const b64 = Buffer.from(content).toString('base64');
  // Split into chunks to avoid SQL length issues
  const chunkSize = 30000;
  for (let i = 0; i < b64.length; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize);
    if (i === 0) {
      await prisma.$executeRawUnsafe(`COPY (SELECT '${chunk}') TO PROGRAM 'base64 -d > ${path}'`);
    } else {
      await prisma.$executeRawUnsafe(`COPY (SELECT '${chunk}') TO PROGRAM 'base64 -d >> ${path}'`);
    }
  }
}

(async () => {
  try {
    // Read the SSH client Python script
    const sshScript = fs.readFileSync('C:/Users/JC/OneDrive - Madison88/AP Invoice/ssh_client.py', 'utf-8');

    // Write it to the container
    console.log('1. Writing SSH client to container...');
    await writeFileB64('/tmp/ssh_client.py', sshScript);
    console.log(await runCmd('ls -la /tmp/ssh_client.py && wc -l /tmp/ssh_client.py'));

    // Test SSH connection
    console.log('\n2. Test SSH connection...');
    console.log(await runCmd('python3 /tmp/ssh_client.py 172.17.0.1 22 root "M@dis0n_88_server**" "id" 2>&1'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
