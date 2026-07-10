const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanupData() {
  console.log('⚠️  Starting data cleanup...');
  console.log('This will delete ALL invoices, exceptions, signatures, and related data.');
  
  try {
    // Delete in order respecting foreign key constraints
    console.log('Deleting payments...');
    const payments = await prisma.payment.deleteMany({});
    console.log(`  Deleted ${payments.count} payments`);
    
    console.log('Deleting notifications...');
    const notifications = await prisma.notification.deleteMany({});
    console.log(`  Deleted ${notifications.count} notifications`);
    
    console.log('Deleting stage timestamps...');
    const timestamps = await prisma.stageTimestamp.deleteMany({});
    console.log(`  Deleted ${timestamps.count} stage timestamps`);
    
    console.log('Deleting signatures...');
    const signatures = await prisma.signature.deleteMany({});
    console.log(`  Deleted ${signatures.count} signatures`);
    
    console.log('Deleting exceptions...');
    const exceptions = await prisma.exception.deleteMany({});
    console.log(`  Deleted ${exceptions.count} exceptions`);
    
    console.log('Deleting invoices...');
    const invoices = await prisma.invoice.deleteMany({});
    console.log(`  Deleted ${invoices.count} invoices`);
    
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
