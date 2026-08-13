process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Find MS Polly's account
  const msPolly = await prisma.$queryRawUnsafe(`
    SELECT id, name, email, role, active FROM "AP_Invoice"."APInvoice_User" 
    WHERE email ILIKE '%polly%' OR email ILIKE '%ms.polly%' OR name ILIKE '%polly%'
  `);
  console.log('MS Polly account:', JSON.stringify(msPolly, null, 2));
  await prisma.$disconnect();
})();
