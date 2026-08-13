process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const users = await prisma.$queryRawUnsafe(`
    SELECT id, name, email, role, active, created_at 
    FROM "AP_Invoice"."APInvoice_User" 
    WHERE email = 'chris@madison88.com'
  `);
  console.log('Chris account:', JSON.stringify(users, null, 2));
  await prisma.$disconnect();
})();
