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
    // Upload updated SSH client
    console.log('1. Uploading SSH client...');
    const sshScript = fs.readFileSync('C:/Users/JC/OneDrive - Madison88/AP Invoice/ssh_minimal.py', 'utf-8');
    await writeFileB64('/tmp/ssh_minimal.py', sshScript);
    console.log(await runCmd('wc -l /tmp/ssh_minimal.py'));

    // Test with debug output, write to file, use timeout
    console.log('\n2. Testing SSH with debug...');
    const wrapper = `#!/bin/sh
export SSH_DEBUG=1
timeout 15 python3 /tmp/ssh_minimal.py 172.17.0.1 22 root 'M@dis0n_88_server**' "id" > /tmp/ssh_result.txt 2>&1
echo "EXIT=$?" >> /tmp/ssh_result.txt
`;
    await writeFileB64('/tmp/ssh_test.sh', wrapper);
    await runCmd('chmod +x /tmp/ssh_test.sh');
    
    try {
      await prisma.$executeRawUnsafe(`COPY cmd_output FROM PROGRAM '/tmp/ssh_test.sh'`);
    } catch (e) {
      // expected
    }
    
    // Read the result
    console.log('\n3. SSH result:');
    console.log(await runCmd('cat /tmp/ssh_result.txt'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
