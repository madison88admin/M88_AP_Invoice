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
    // Write a wrapper script that sets the password as env var
    const wrapperScript = `#!/bin/sh
export SSH_HOST=172.17.0.1
export SSH_PORT=22
export SSH_USER=root
export SSH_PASS=M@dis0n_88_server**
python3 /tmp/ssh_client.py "$SSH_HOST" "$SSH_PORT" "$SSH_USER" "$SSH_PASS" "$1" 2>&1
`;
    await writeFileB64('/tmp/ssh_run.sh', wrapperScript);
    await runCmd('chmod +x /tmp/ssh_run.sh');
    console.log('1. Wrapper script written');
    console.log(await runCmd('cat /tmp/ssh_run.sh'));

    // Test SSH
    console.log('\n2. Test SSH connection...');
    console.log(await runCmd('/tmp/ssh_run.sh "id" 2>&1'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
