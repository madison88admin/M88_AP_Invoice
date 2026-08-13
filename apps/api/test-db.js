const { PrismaClient } = require('@prisma/client');

async function test() {
  const prisma = new PrismaClient();
  try {
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('SUCCESS:', result);
  } catch (e) {
    console.log('ERROR:', e.message.substring(0, 150));
  } finally {
    await prisma.$disconnect();
  }
}

test();
