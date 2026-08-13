const http = require('http');

function req(method, path, body, token) {
  return new Promise(resolve => {
    const d = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (d) headers['Content-Length'] = Buffer.byteLength(d);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const o = { hostname: '5.223.78.194', port: 80, path, method, headers };
    const r = http.request(o, s => {
      let b = '';
      s.on('data', c => b += c);
      s.on('end', () => {
        try { resolve({ status: s.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: s.statusCode, data: b }); }
      });
    });
    r.on('error', e => resolve({ status: 0, error: e.message }));
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  // Login
  const login = await req('POST', '/api/auth/login', { email: 'jc@madison88.com', password: 'Ar5yG3#4' });
  const token = login.data.token;

  // Clear previous debug logs
  process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
  const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
  const prisma = new PrismaClient({ log: ['error'] });

  await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."DebugInsertLog"`);
  console.log('Cleared debug logs');

  // Trigger POST via VPS API
  console.log('\nTriggering POST /api/users on VPS...');
  const result = await req('POST', '/api/users', {
    name: 'Test Debug',
    email: 'testdebug99@madison88.com',
    role: 'PURCHASING_COORDINATOR',
    password: 'testpass123'
  }, token);
  console.log('VPS API response:', result.status, JSON.stringify(result.data).substring(0, 200));

  // Wait a moment for triggers to complete
  await new Promise(r => setTimeout(r, 1000));

  // Check debug logs
  console.log('\nChecking debug logs...');
  const logs = await prisma.$queryRawUnsafe(`
    SELECT id, table_name, new_data, error_msg, created_at
    FROM "AP_Invoice"."DebugInsertLog"
    ORDER BY id DESC
    LIMIT 10
  `);
  console.log(`Found ${logs.length} log entries:`);
  logs.forEach(l => {
    console.log(`\n  [${l.id}] table=${l.table_name}, error=${l.error_msg || 'N/A'}, time=${l.created_at}`);
    console.log(`  data=${l.new_data?.substring(0, 500)}`);
  });

  // Clean up: if the user was created, delete it
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "AP_Invoice"."APInvoice_User" WHERE email = 'testdebug99@madison88.com'`);
  } catch {}

  await prisma.$disconnect();
})();
