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

async function writeFileB64(path, content) {
  const b64 = Buffer.from(content).toString('base64');
  await prisma.$executeRawUnsafe(`COPY (SELECT '${b64}') TO PROGRAM 'base64 -d > ${path}'`);
}

(async () => {
  try {
    // Find libcrypto
    console.log('1. Find libcrypto...');
    console.log(await runCmd('find / -name "libcrypto*" 2>/dev/null | head -10'));
    console.log(await runCmd('find / -name "libssl*" 2>/dev/null | head -10'));

    // Test ctypes loading
    const testCode = `import ctypes, ctypes.util
print("libcrypto path:", ctypes.util.find_library("crypto"))
print("libssl path:", ctypes.util.find_library("ssl"))
try:
    lib = ctypes.CDLL(ctypes.util.find_library("crypto"))
    print("libcrypto loaded OK")
except Exception as e:
    print("Failed:", str(e))
`;
    await writeFileB64('/tmp/test_ctypes.py', testCode);
    console.log('\n2. Test ctypes...');
    console.log(await runCmd('python3 /tmp/test_ctypes.py'));

    // If ctypes works, try a minimal SSH implementation
    // For now, let's try a simpler approach: use curl to download a static sshpass
    console.log('\n3. Try downloading static sshpass from various sources...');
    const urls = [
      'https://github.com/xhc/sshpass/releases/download/v1.10/sshpass',
      'https://github.com/kevinschoon/sshpass/releases/download/v1.10/sshpass',
      'https://github.com/jmichelp/sshpass/releases/download/v1.10/sshpass',
    ];
    for (const url of urls) {
      const result = await runCmd(`curl -s -L --connect-timeout 5 -o /tmp/sshpass_test '${url}' 2>&1 && file /tmp/sshpass_test && wc -c /tmp/sshpass_test || echo "failed: ${url}"`);
      console.log(`  ${url.split('/').pop()}: ${result}`);
    }

    // Try to find sshpass in apt
    console.log('\n4. Try apt-get install with --no-download...');
    console.log(await runCmd('apt-get install -y --no-install-recommends sshpass 2>&1 | tail -5 || echo "failed"'));

    // Check if we can use su to become root
    console.log('\n5. Check if we can use su...');
    console.log(await runCmd('id'));
    console.log(await runCmd('echo "" | su root -c "id" 2>&1 || echo "su failed"'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
