import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupData() {
  console.log('⚠️  Starting data cleanup...');
  console.log('This will delete ALL invoices, exceptions, signatures, and related data.');
  
  try {
    // Delete in order respecting foreign key constraints
    console.log('Deleting payments...');
    await prisma.payment.deleteMany({});
    
    console.log('Deleting notifications...');
    await prisma.notification.deleteMany({});
    
    console.log('Deleting stage timestamps...');
    await prisma.stageTimestamp.deleteMany({});
    
    console.log('Deleting signatures...');
    await prisma.signature.deleteMany({});
    
    console.log('Deleting exceptions...');
    await prisma.exception.deleteMany({});
    
    console.log('Deleting invoices...');
    await prisma.invoice.deleteMany({});
    
    console.log('✅ Data cleanup completed successfully!');
    console.log('All invoice data has been deleted from the database.');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanupData();
