process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('C:/Users/JC/OneDrive - Madison88/AP Invoice/apps/api/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const inv = await p.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Invoice"`);
  const notif = await p.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM "AP_Invoice"."APInvoice_Notification"`);
  console.log('Invoices:', inv[0].cnt);
  console.log('Notifications:', notif[0].cnt);
  await p.$disconnect();
})();
