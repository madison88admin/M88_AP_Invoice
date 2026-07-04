import prisma from '../config/database';

export interface AuditLogEntry {
  invoice_id?: string;
  performed_by?: string;
  action: string;
  note?: string;
  metadata?: Record<string, any>;
}

export async function logAudit(entry: AuditLogEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        invoice_id: entry.invoice_id || null,
        performed_by: entry.performed_by || null,
        action: entry.action,
        note: entry.note || null,
      },
    });
  } catch (error) {
    console.error('[auditLog] Failed to write audit log:', error);
  }
}

export async function getAuditLogs(filters: {
  invoiceId?: string;
  action?: string;
  performedBy?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};

  if (filters.invoiceId) {
    where.invoice_id = filters.invoiceId;
  }
  if (filters.action) {
    where.action = { contains: filters.action, mode: 'insensitive' };
  }
  if (filters.performedBy) {
    where.performed_by = { contains: filters.performedBy, mode: 'insensitive' };
  }
  if (filters.startDate || filters.endDate) {
    where.created_at = {};
    if (filters.startDate) {
      where.created_at.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.created_at.lte = new Date(filters.endDate);
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: filters.limit || 100,
      skip: filters.offset || 0,
      include: {
        invoice: {
          select: {
            invoice_number: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}
