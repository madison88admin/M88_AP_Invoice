process.env.DATABASE_URL = 'postgresql://supabase_admin.m88:Madison_88_admin**@5.223.78.194:5432/postgres?schema=AP_Invoice';
const { PrismaClient } = require('./apps/api/node_modules/@prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { email: true, name: true, role: true }, take: 5 })
  .then(u => console.log(JSON.stringify(u, null, 2)))
  .catch(e => console.error(e.message))
  .finally(() => p.$disconnect());
