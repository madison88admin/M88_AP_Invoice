import { Request, Response } from 'express';
import prisma from '../config/database';

/**
 * Cleanup all invoice data from the database
 * WARNING: This deletes ALL invoices, exceptions, signatures, and related data
 * This action cannot be undone
 */
export async function cleanupData(req: Request, res: Response) {
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
    
    res.json({
      success: true,
      message: 'All invoice data has been deleted from the database',
      deleted: {
        payments: payments.count,
        notifications: notifications.count,
        timestamps: timestamps.count,
        signatures: signatures.count,
        exceptions: exceptions.count,
        invoices: invoices.count,
      },
    });
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup data',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
