import prisma from '../config/database';

export async function resolveException(
  exceptionId: string,
  resolution: string,
  userId: string
) {
  const exception = await prisma.exception.findUnique({
    where: { id: exceptionId },
    include: { invoice: true },
  });

  if (!exception) {
    throw new Error('Exception not found');
  }

  if (exception.status === 'RESOLVED') {
    throw new Error('Exception is already resolved');
  }

  // Update exception status to RESOLVED
  const updatedException = await prisma.exception.update({
    where: { id: exceptionId },
    data: {
      status: 'RESOLVED',
      resolution,
      resolved_at: new Date(),
      resolved_by: userId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: exception.invoice_id,
      action: 'EXCEPTION_RESOLVED',
      user_id: userId,
      detail: `Exception "${exception.reason}" resolved: ${resolution}`,
    },
  });

  // Check if all exceptions for this invoice are resolved
  const remainingExceptions = await prisma.exception.count({
    where: {
      invoice_id: exception.invoice_id,
      status: 'PENDING',
    },
  });

  // If no remaining exceptions and invoice is in EXCEPTION status, update to VALIDATED
  if (remainingExceptions === 0) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: exception.invoice_id },
    });

    if (invoice && invoice.status === 'EXCEPTION') {
      await prisma.invoice.update({
        where: { id: exception.invoice_id },
        data: { status: 'VALIDATED' },
      });

      await prisma.auditLog.create({
        data: {
          invoice_id: exception.invoice_id,
          action: 'STATUS_CHANGED',
          user_id: userId,
          detail: 'Invoice status changed from EXCEPTION to VALIDATED after all exceptions resolved',
        },
      });
    }
  }

  return updatedException;
}

export async function getPendingExceptions() {
  const pendingExceptions = await prisma.exception.findMany({
    where: {
      status: 'PENDING',
    },
    include: {
      invoice: {
        include: {
          vendor: true,
        },
      },
    },
    orderBy: {
      created_at: 'asc',
    },
  });

  return pendingExceptions;
}

export async function getExceptionsByInvoice(invoiceId: string) {
  const exceptions = await prisma.exception.findMany({
    where: {
      invoice_id: invoiceId,
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  return exceptions;
}

export async function waiveException(
  exceptionId: string,
  waiverReason: string,
  userId: string
) {
  const exception = await prisma.exception.findUnique({
    where: { id: exceptionId },
    include: { invoice: true },
  });

  if (!exception) {
    throw new Error('Exception not found');
  }

  if (exception.status === 'RESOLVED') {
    throw new Error('Exception is already resolved');
  }

  // Update exception status to WAIVED
  const updatedException = await prisma.exception.update({
    where: { id: exceptionId },
    data: {
      status: 'WAIVED',
      resolution: `Waived: ${waiverReason}`,
      resolved_at: new Date(),
      resolved_by: userId,
    },
  });

  // Create audit log entry
  await prisma.auditLog.create({
    data: {
      invoice_id: exception.invoice_id,
      action: 'EXCEPTION_WAIVED',
      user_id: userId,
      detail: `Exception "${exception.reason}" waived: ${waiverReason}`,
    },
  });

  // Check if all exceptions for this invoice are resolved or waived
  const pendingExceptions = await prisma.exception.count({
    where: {
      invoice_id: exception.invoice_id,
      status: 'PENDING',
    },
  });

  // If no pending exceptions and invoice is in EXCEPTION status, update to VALIDATED
  if (pendingExceptions === 0) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: exception.invoice_id },
    });

    if (invoice && invoice.status === 'EXCEPTION') {
      await prisma.invoice.update({
        where: { id: exception.invoice_id },
        data: { status: 'VALIDATED' },
      });

      await prisma.auditLog.create({
        data: {
          invoice_id: exception.invoice_id,
          action: 'STATUS_CHANGED',
          user_id: userId,
          detail: 'Invoice status changed from EXCEPTION to VALIDATED after all exceptions resolved/waived',
        },
      });
    }
  }

  return updatedException;
}
