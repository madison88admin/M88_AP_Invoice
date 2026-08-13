process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const users = await prisma.$queryRawUnsafe(`
    SELECT id, name, email, role, active FROM "AP_Invoice"."APInvoice_User" 
    ORDER BY name
  `);
  console.log('All users:');
  users.forEach(u => console.log(`  ${u.name} | ${u.email} | ${u.role} | active=${u.active}`));
  await prisma.$disconnect();
})();
