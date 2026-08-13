process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Check what notifications exist
  const notifs = await prisma.$queryRawUnsafe(`SELECT id, title, type, category, created_at FROM "AP_Invoice"."APInvoice_Notification" ORDER BY created_at DESC LIMIT 10`);
  console.log('Current notifications:');
  notifs.forEach(n => console.log('  ', n.id, n.title, n.type, n.category, n.created_at));
  
  // Clear again
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AP_Invoice"."APInvoice_Notification" CASCADE;`);
  const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Notification"`);
  console.log('After clear:', count[0].cnt, 'rows');
  
  await prisma.$disconnect();
})();
