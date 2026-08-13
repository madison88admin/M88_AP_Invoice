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
    // Check exact libssh2 paths
    console.log('1. Find libssh2...');
    console.log(await runCmd('find /nix/store -name "libssh2*" 2>/dev/null'));
    console.log(await runCmd('ls -la /nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/ 2>/dev/null'));

    // Test loading with Python
    const testScript = `import ctypes, sys
paths = [
    '/nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/libssh2.so.1.0.1',
    '/nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/libssh2.so.1',
    '/nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/libssh2.so',
    '/nix/store/gqrbbhxahk4mayblnc0sfpksgph197bb-libssh2-1.11.0/lib/libssh2.so.1.0.1',
    'libssh2.so.1',
    'libssh2.so',
]
for p in paths:
    try:
        lib = ctypes.CDLL(p)
        print("OK: " + p)
        # Try to call a function
        lib.libssh2_init(0)
        print("  libssh2_init OK")
        break
    except Exception as e:
        print("FAIL: " + p + " -> " + str(e))
`;
    await writeFileB64('/tmp/test_lib.py', testScript);
    console.log('\n2. Test loading libssh2...');
    console.log(await runCmd('python3 /tmp/test_lib.py 2>&1'));

    // Check if libssh2 has dependencies
    console.log('\n3. Check dependencies...');
    console.log(await runCmd('ldd /nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib/libssh2.so.1.0.1 2>/dev/null || echo "ldd failed"'));

    // Try setting LD_LIBRARY_PATH
    console.log('\n4. Try with LD_LIBRARY_PATH...');
    console.log(await runCmd('LD_LIBRARY_PATH=/nix/store/1n0b29iid3y0w9i91v9zqdiwnx3inak0-libssh2-1.11.1/lib:/nix/store/k1dsk0zyq43pvi7f76is2rx6l4aphm5z-openssl-3.3.2/lib python3 /tmp/test_lib.py 2>&1'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
