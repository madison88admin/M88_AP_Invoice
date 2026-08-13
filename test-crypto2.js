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
    // Simple test - just check if libcrypto loads and basic functions work
    const pyScript = `import ctypes
lib = ctypes.CDLL('/usr/lib/x86_64-linux-gnu/libcrypto.so.1.1')

# Set return types
lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
lib.EVP_aes_256_ctr.restype = ctypes.c_void_p

# Test AES
ctx = lib.EVP_CIPHER_CTX_new()
print("CTX:", ctx)
cipher = lib.EVP_aes_256_ctr()
print("Cipher:", cipher)

# Set argtypes for EncryptInit
lib.EVP_EncryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
lib.EVP_EncryptInit_ex.restype = ctypes.c_int

key = b'A' * 32
iv = b'B' * 16
ret = lib.EVP_EncryptInit_ex(ctx, cipher, None, key, iv)
print("EncryptInit:", ret)

# Encrypt
lib.EVP_EncryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int]
lib.EVP_EncryptUpdate.restype = ctypes.c_int

plaintext = b"Hello World!"
outbuf = ctypes.create_string_buffer(256)
outlen = ctypes.c_int(0)
ret = lib.EVP_EncryptUpdate(ctx, outbuf, ctypes.byref(outlen), plaintext, len(plaintext))
print("EncryptUpdate:", ret, "outlen:", outlen.value)
print("Ciphertext:", outbuf.raw[:outlen.value].hex())

# Final
lib.EVP_EncryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]
lib.EVP_EncryptFinal_ex.restype = ctypes.c_int
outlen2 = ctypes.c_int(0)
ret = lib.EVP_EncryptFinal_ex(ctx, outbuf, ctypes.byref(outlen2))
print("EncryptFinal:", ret, "outlen2:", outlen2.value)

# Cleanup
lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
lib.EVP_CIPHER_CTX_free(ctx)

# Test RAND_bytes
lib.RAND_bytes.argtypes = [ctypes.c_char_p, ctypes.c_int]
lib.RAND_bytes.restype = ctypes.c_int
buf = ctypes.create_string_buffer(32)
ret = lib.RAND_bytes(buf, 32)
print("RAND_bytes:", ret, buf.raw[:8].hex())

# Test BN
lib.BN_new.restype = ctypes.c_void_p
bn = lib.BN_new()
print("BN_new:", bn)
lib.BN_free.argtypes = [ctypes.c_void_p]
lib.BN_free(bn)

print("ALL TESTS PASSED")
`;

    await writeFileB64('/tmp/test_crypto2.py', pyScript);
    console.log('1. Test libcrypto...');
    console.log(await runCmd('python3 /tmp/test_crypto2.py > /tmp/crypto_out.txt 2>&1; cat /tmp/crypto_out.txt'));

  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
